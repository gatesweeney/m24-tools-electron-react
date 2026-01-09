// indexer/worker/main.js
const { MountWatcher } = require('./platform/mounts');
const { ScanQueue } = require('./scheduler/queue');
const { createCancelToken } = require('./scheduler/jobState');
const { upsertVolume } = require('./volumes/upsert');
const { openDb } = require('./db/openDb');
const { getDueVolumes, getDueManualRoots } = require('./scheduler/due');
const { runVolumeScan, runManualRootScan } = require('./scan/scanManager');
const { startScanRun, finishScanRun } = require('./db/scanRuns');

let triggerManualScan = null;

let mountQueueRef = null;
let scheduledQueueRef = null;

function computeStatus() {
  const m = mountQueueRef?.getCounts?.() || { running: 0, queued: 0 };
  const s = scheduledQueueRef?.getCounts?.() || { running: 0, queued: 0 };
  return {
    runningMount: m.running,
    queuedMount: m.queued,
    runningScheduled: s.running,
    queuedScheduled: s.queued,
    runningTotal: m.running + s.running,
    queuedTotal: m.queued + s.queued
  };
}

let started = false;

function ensureStarted() {
  if (started) return;
  started = true;
  try {
    startWorker();
  } catch (e) {
    console.error('[indexer] startWorker failed:', e);
    started = false;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function sendToParent(message) {
  try {
    if (process.send) process.send(message);
  } catch {}
}

function emitProgress(label, payload) {
  sendToParent({
    cmd: 'indexerProgress',
    label,
    payload,
    at: isoNow()
  });
}

function logScanStart({ label, type, name, id, path }) {
  console.log(
    '[indexer]',
    'SCAN START',
    `(${label})`,
    `${type}=${name}`,
    id ? `id=${id}` : '',
    `path=${path}`,
    `at=${isoNow()}`
  );
}

function logScanDone({ label, type, name, durationMs }) {
  console.log(
    '[indexer]',
    'SCAN DONE ',
    `(${label})`,
    `${type}=${name}`,
    `duration=${(durationMs / 1000).toFixed(1)}s`,
    `at=${isoNow()}`
  );
}

function logScanCancelled({ label, type, name }) {
  console.log(
    '[indexer]',
    'SCAN CANCELLED',
    `(${label})`,
    `${type}=${name}`,
    `at=${isoNow()}`
  );
}

function createManualRootJob(root, { label }) {
  const token = createCancelToken();

  return {
    key: `manual:${root.id}`,
    cancel: () => token.cancel(),
    run: async () => {
      const start = Date.now();
      const db = openDb();

      const name = root.label || root.path;

      logScanStart({
        label,
        type: 'root',
        name,
        id: root.id,
        path: root.path
      });

      try {
        await runManualRootScan({
          db,
          root,
          cancelToken: token,
          progress: (p) => {
            console.log('[progress]', label, p);
            emitProgress(label, {
              ...p,
              targetType: 'root',
              rootId: root.id,
              rootPath: root.path,
              name: root.label || root.path
            });
          }
        });

        if (token.cancelled) {
          logScanCancelled({ label, type: 'root', name });
          return;
        }

        logScanDone({
          label,
          type: 'root',
          name,
          durationMs: Date.now() - start
        });
      } finally {
        db.close();
      }
    }
  };
}

function createVolumeJob(mount, { label }) {
  const token = createCancelToken();

  return {
    key: mount.key,
    cancel: () => token.cancel(),
    run: async () => {
  if (mount.kind !== 'volume') return;

  const start = Date.now();
  const db = openDb();

  logScanStart({
    label,
    type: 'volume',
    name: mount.volume_name,
    id: mount.volume_uuid,
    path: mount.mount_point
  });

  emitProgress(label, { stage: 'SCAN_START', targetType: 'volume', volume_uuid: mount.volume_uuid, rootPath: mount.mount_point, name: mount.volume_name });

  try {
    await runVolumeScan({
      db,
      volume: mount,
      cancelToken: token,
      progress: (p) => {
        console.log('[progress]', label, p);
        emitProgress(label, {
          ...p,
          targetType: 'volume',
          volume_uuid: mount.volume_uuid,
          rootPath: mount.mount_point,
          name: mount.volume_name
        });
      }
    });

    if (token.cancelled) {
      logScanCancelled({
        label,
        type: 'volume',
        name: mount.volume_name
      });
      return;
    }

    emitProgress(label, { stage: 'SCAN_DONE', targetType: 'volume', volume_uuid: mount.volume_uuid, rootPath: mount.mount_point, name: mount.volume_name });

    logScanDone({
      label,
      type: 'volume',
      name: mount.volume_name,
      durationMs: Date.now() - start
    });
  } finally {
    db.close();
  }
}
  };
}

function startWorker() {

  const mountQueue = new ScanQueue({ concurrency: 4 });      // new mounts
  const scheduledQueue = new ScanQueue({ concurrency: 1 });  // periodic

  mountQueueRef = mountQueue;
  scheduledQueueRef = scheduledQueue;

  const watcher = new MountWatcher({ intervalMs: 2000 });

  // Track currently mounted physical volumes + mountpoints
  let mountedVolumeUuids = [];
  let mountedMountPoints = [];
  let latestMounts = [];

  triggerManualScan = ({ type, volumeUuid, rootId }) => {
    console.log('[indexer]', 'manualScan request', { type, volumeUuid, rootId });

    if (type === 'scanAllMountedVolumes') {
      // enqueue all mounted physical volumes that are active
      const db = openDb();
      const activeSet = new Set(
        db.prepare(`SELECT volume_uuid FROM volumes WHERE is_active=1`).all().map(r => r.volume_uuid)
      );
      db.close();

      const mounts = latestMounts.filter(m => m.kind === 'volume' && activeSet.has(m.volume_uuid));
      for (const m of mounts) {
        mountQueue.enqueue(createVolumeJob(m, { label: 'MANUAL_ALL' }));
      }
      console.log('[indexer]', 'manualScan enqueued', { type: 'scanAllMountedVolumes', volumesQueued: mounts.length });
      return mounts.length;
    }

    if (type === 'scanAll') {
      const db = openDb();
      const activeSet = new Set(
        db.prepare(`SELECT volume_uuid FROM volumes WHERE is_active=1`).all().map(r => r.volume_uuid)
      );
      // volumes (mounted)
      const mounts = latestMounts.filter(m => m.kind === 'volume' && activeSet.has(m.volume_uuid));
      mounts.forEach(m => mountQueue.enqueue(createVolumeJob(m, { label: 'MANUAL_ALL' })));

      // manual roots
      const roots = db.prepare('SELECT * FROM manual_roots WHERE is_active=1').all();
      db.close();
      roots.forEach(r => scheduledQueue.enqueue(createManualRootJob(r, { label: 'MANUAL_ALL' })));

      console.log('[indexer]', 'manualScan enqueued', { type: 'scanAll', volumesQueued: mounts.length, rootsQueued: roots.length });
      return { volumesQueued: mounts.length, rootsQueued: roots.length };
    }

    if (type === 'volume') {
      const mount = latestMounts.find(
        (m) => m.kind === 'volume' && m.volume_uuid === volumeUuid
      );
      if (!mount) return false;

      mountQueue.enqueue(createVolumeJob(mount, { label: 'MANUAL' }));
      console.log('[indexer]', 'manualScan enqueued', { type: 'volume', volumeUuid });
      return true;
    }

    if (type === 'manualRoot') {
      const db = openDb();
      const root = db.prepare(
        'SELECT * FROM manual_roots WHERE id = ?'
      ).get(rootId);
      db.close();
      if (!root) return false;

      scheduledQueue.enqueue(createManualRootJob(root, { label: 'MANUAL' }));
      console.log('[indexer]', 'manualScan enqueued', { type: 'manualRoot', rootId });
      return true;
    }

    return false;
  };
  console.log('[indexer] triggerManualScan installed');

  watcher.on('ready', (mounts) => {
    latestMounts = mounts;
    mountedVolumeUuids = mounts.filter(m => m.kind === 'volume').map(m => m.volume_uuid);
    mountedMountPoints = mounts.map(m => m.mount_point);
  });

  watcher.on('mounted', (mount) => {
    console.log('[mount] mounted', mount.mount_point, mount.volume_name || '');

    latestMounts = Array.from(new Map([...latestMounts, mount].map(m => [m.key, m])).values());
    mountedVolumeUuids = latestMounts.filter(m => m.kind === 'volume').map(m => m.volume_uuid);
    mountedMountPoints = latestMounts.map(m => m.mount_point);

    if (mount.kind !== 'volume') return;

    // Upsert volume record (creates if new, updates mount_point if existing)
    const vol = upsertVolume(mount);

    // Always scan on mount unless explicitly disabled
    if (vol && vol.is_active) {
      console.log('[mount] enqueueing immediate scan for', mount.volume_name);
      mountQueue.enqueue(createVolumeJob(mount, { label: 'MOUNT' }));
    } else {
      console.log('[mount] skipping scan - volume is disabled:', mount.volume_name);
    }
  });

  watcher.on('unmounted', (mount) => {
    console.log('[mount] unmounted', mount.mount_point);

    // cancel any running/queued jobs for this mount key
    mountQueue.cancel(mount.key);
    scheduledQueue.cancel(mount.key);

    latestMounts = latestMounts.filter(m => m.key !== mount.key);
    mountedVolumeUuids = latestMounts.filter(m => m.kind === 'volume').map(m => m.volume_uuid);
    mountedMountPoints = latestMounts.map(m => m.mount_point);
  });

  watcher.start();

  // Periodic scheduler: every 60s, enqueue due scans (mounted volumes only)
  setInterval(() => {
    try {
      const dueVolumes = getDueVolumes({ mountedVolumeUuids, onlyMounted: true });

      // For each due volume, find its current mount record so we have mount_point
      const byUuid = new Map(
        latestMounts
          .filter(m => m.kind === 'volume')
          .map(m => [m.volume_uuid, m])
      );

      for (const v of dueVolumes) {
        const mount = byUuid.get(v.volume_uuid);
        if (!mount) continue;

        // enqueue a scheduled scan job
        scheduledQueue.enqueue(createVolumeJob(mount, { label: 'SCHEDULED' }));
      }

      // Manual roots scheduling (we’ll implement manual root scan manager later)
      // For now, we’re just reading them so you can confirm due logic works.
      const dueRoots = getDueManualRoots({ mountedMountPoints });
      for (const r of dueRoots) {
        scheduledQueue.enqueue(createManualRootJob(r, { label: 'SCHEDULED' }));
      }
    } catch (e) {
      console.error('[scheduler] error:', e);
    }
  }, 60 * 1000);
}

function manualScan(payload) {
  if (typeof triggerManualScan !== 'function') {
    ensureStarted();
  }
  if (typeof triggerManualScan !== 'function') return false;
  return triggerManualScan(payload);
}

module.exports = { startWorker, manualScan };

console.log('[indexer] worker boot', {
  pid: process.pid,
  argv0: process.argv[0],
  argv1: process.argv[1],
  autostart: process.env.M24_WORKER_AUTOSTART
});

if (require.main === module || process.env.M24_WORKER_AUTOSTART === '1') {
  ensureStarted();
}

// Allow Electron main to tell the already-running worker to enqueue scans
process.on('message', (msg) => {
  if (msg?.cmd !== 'indexerStatus') console.log('[worker] received msg', msg);
  if (!msg || typeof msg !== 'object') return;

  if (msg.cmd === 'manualScan') {
    ensureStarted();
    const attempt = () => manualScan(msg.payload);
    let result = attempt();
    if (result === false) {
      setTimeout(() => {
        result = attempt();
        console.log('[worker] manualScan retry result', result);
        if (process.send) {
          process.send({ cmd: 'manualScanResult', result, at: new Date().toISOString() });
        }
      }, 200);
      return;
    }
    console.log('[worker] manualScan result', result);
    if (process.send) {
      process.send({ cmd: 'manualScanResult', result, at: new Date().toISOString() });
    }
    return;
  }

  if (msg.cmd === 'indexerStatus') {
    const status = computeStatus();
    if (process.send) process.send({ cmd: 'indexerStatus', status, at: isoNow() });
    return;
  }

  if (msg.cmd === 'indexerCancelAll') {
    mountQueueRef?.cancelAll?.();
    scheduledQueueRef?.cancelAll?.();
    const status = computeStatus();
    if (process.send) process.send({ cmd: 'indexerStatus', status, at: isoNow() });
    return;
  }

  if (msg.cmd === 'indexerCancelKey' && msg.key) {
    mountQueueRef?.cancel?.(msg.key);
    scheduledQueueRef?.cancel?.(msg.key);
    const status = computeStatus();
    if (process.send) process.send({ cmd: 'indexerStatus', status, at: isoNow() });
    return;
  }

  if (msg.cmd === 'indexerCancelCurrent') {
    const cancelledKey =
      scheduledQueueRef?.cancelCurrent?.() ?? mountQueueRef?.cancelCurrent?.() ?? null;
    const status = computeStatus();
    if (process.send) process.send({ cmd: 'indexerStatus', status, cancelledKey, at: isoNow() });
    return;
  }
});
