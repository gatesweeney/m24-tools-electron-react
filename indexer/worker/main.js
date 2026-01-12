// indexer/worker/main.js
const { MountWatcher } = require('./platform/mounts');
const { ScanQueue } = require('./scheduler/queue');
const { createCancelToken } = require('./scheduler/jobState');
const { runVolumeScan, runManualRootScan } = require('./scan/scanManager');
const os = require('os');
const { fetchState, upsertState, registerDevice, getDeviceId } = require('./remoteApi');

let triggerManualScan = null;

let mountQueueRef = null;
let scheduledQueueRef = null;
let remoteStateCache = { volumes: [], manualRoots: [] };

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

function parseIso(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function getDueVolumesFromState(volumes, { mountedVolumeUuids, onlyMounted = true } = {}) {
  const now = Date.now();
  const mountedSet = new Set(mountedVolumeUuids || []);

  return (volumes || [])
    .filter((v) => v && v.is_active !== 0)
    .filter((v) => (onlyMounted ? mountedSet.has(v.volume_uuid) : true))
    .filter((v) => {
      const interval = (v.scan_interval_ms == null) ? 20 * 60 * 1000 : v.scan_interval_ms;
      if (interval === 0 || interval < 0) return false;
      const last = parseIso(v.last_scan_at);
      return (now - last) >= interval;
    })
    .sort((a, b) => parseIso(a.last_scan_at) - parseIso(b.last_scan_at));
}

function getDueManualRootsFromState(roots, { mountedMountPoints } = {}) {
  const now = Date.now();
  const mountedSet = new Set(mountedMountPoints || []);

  return (roots || [])
    .filter((r) => r && r.is_active !== 0)
    .filter((r) => {
      if (!r.path) return false;
      if (r.path.startsWith('/Volumes/')) return mountedSet.has(r.path);
      return true;
    })
    .filter((r) => {
      const interval = r.scan_interval_ms;
      if (interval == null || interval === 0 || interval < 0) return false;
      const last = parseIso(r.last_scan_at);
      return (now - last) >= interval;
    })
    .sort((a, b) => parseIso(a.last_scan_at) - parseIso(b.last_scan_at));
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

async function upsertMountedVolumes(mounts) {
  const deviceId = getDeviceId();
  const volumes = (mounts || [])
    .filter((m) => m.kind === 'volume' && m.volume_uuid)
    .map((m) => ({
      volume_uuid: m.volume_uuid,
      volume_name: m.volume_name,
      mount_point_last: m.mount_point,
      size_bytes: m.size_bytes || null,
      fs_type: m.fs_type || null,
      last_seen_at: isoNow(),
      is_active: 1,
      scan_interval_ms: 20 * 60 * 1000,
      device_id: deviceId
    }));

  if (!volumes.length) return;
  await upsertState({ deviceId, volumes, manualRoots: [], files: [] });
  console.log('[indexer] mounted volumes upserted', { count: volumes.length });
}

async function refreshRemoteState() {
  const res = await fetchState();
  if (res?.ok) {
    remoteStateCache = {
      volumes: res.volumes || [],
      manualRoots: res.manualRoots || []
    };
  }
  return remoteStateCache;
}

function createManualRootJob(root, { label, generateThumbs = false } = {}) {
  const token = createCancelToken();

  return {
    key: `manual:${root.id}`,
    cancel: () => token.cancel(),
    run: async () => {
      const start = Date.now();

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
          root,
          cancelToken: token,
          generateThumbs,
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
      } catch (err) {
        console.error('[indexer] manual root scan failed', err?.message || err);
      }
    }
  };
}

function createVolumeJob(mount, { label, generateThumbs = false } = {}) {
  const token = createCancelToken();

  return {
    key: mount.key,
    cancel: () => token.cancel(),
    run: async () => {
      if (mount.kind !== 'volume') return;

      const start = Date.now();

      logScanStart({
        label,
        type: 'volume',
        name: mount.volume_name,
        id: mount.volume_uuid,
        path: mount.mount_point
      });

      emitProgress(label, {
        stage: 'SCAN_START',
        targetType: 'volume',
        volume_uuid: mount.volume_uuid,
        rootPath: mount.mount_point,
        name: mount.volume_name
      });

      try {
        await runVolumeScan({
          volume: mount,
          cancelToken: token,
          generateThumbs,
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

        emitProgress(label, {
          stage: 'SCAN_DONE',
          targetType: 'volume',
          volume_uuid: mount.volume_uuid,
          rootPath: mount.mount_point,
          name: mount.volume_name
        });

        logScanDone({
          label,
          type: 'volume',
          name: mount.volume_name,
          durationMs: Date.now() - start
        });
      } catch (err) {
        console.error('[indexer] volume scan failed', err?.message || err);
      }
    }
  };
}

function startWorker() {

  const mountQueue = new ScanQueue({ concurrency: 4 });      // new mounts
  const scheduledQueue = new ScanQueue({ concurrency: 1 });  // periodic

  mountQueueRef = mountQueue;
  scheduledQueueRef = scheduledQueue;

  registerDevice(os.hostname()).catch((e) => {
    console.error('[indexer] registerDevice failed:', e?.message || e);
  });
  refreshRemoteState().catch((e) => {
    console.error('[indexer] refreshRemoteState failed:', e?.message || e);
  });

  const watcher = new MountWatcher({ intervalMs: 2000 });

  // Track currently mounted physical volumes + mountpoints
  let mountedVolumeUuids = [];
  let mountedMountPoints = [];
  let latestMounts = [];

  triggerManualScan = async ({ type, volumeUuid, rootId, generateThumbs }) => {
    console.log('[indexer]', 'manualScan request', { type, volumeUuid, rootId });
    await refreshRemoteState();
    const withThumbs = !!generateThumbs;

    if (type === 'scanAllMountedVolumes') {
      // enqueue all mounted physical volumes that are active
      const activeSet = new Set(
        (remoteStateCache.volumes || []).filter((v) => v?.is_active !== 0).map((v) => v.volume_uuid)
      );
      const mounts = latestMounts.filter(m => m.kind === 'volume' && activeSet.has(m.volume_uuid));
      for (const m of mounts) {
        mountQueue.enqueue(createVolumeJob(m, { label: 'MANUAL_ALL', generateThumbs: withThumbs }));
      }
      console.log('[indexer]', 'manualScan enqueued', { type: 'scanAllMountedVolumes', volumesQueued: mounts.length });
      return mounts.length;
    }

    if (type === 'scanAll') {
      const activeSet = new Set(
        (remoteStateCache.volumes || []).filter((v) => v?.is_active !== 0).map((v) => v.volume_uuid)
      );
      // volumes (mounted)
      const mounts = latestMounts.filter(m => m.kind === 'volume' && activeSet.has(m.volume_uuid));
      mounts.forEach(m => mountQueue.enqueue(createVolumeJob(m, { label: 'MANUAL_ALL', generateThumbs: withThumbs })));

      // manual roots
      const roots = (remoteStateCache.manualRoots || []).filter((r) => r?.is_active !== 0);
      roots.forEach(r => scheduledQueue.enqueue(createManualRootJob(r, { label: 'MANUAL_ALL', generateThumbs: withThumbs })));

      console.log('[indexer]', 'manualScan enqueued', { type: 'scanAll', volumesQueued: mounts.length, rootsQueued: roots.length });
      return { volumesQueued: mounts.length, rootsQueued: roots.length };
    }

    if (type === 'volume') {
      const mount = latestMounts.find(
        (m) => m.kind === 'volume' && m.volume_uuid === volumeUuid
      );
      if (!mount) return false;

      mountQueue.enqueue(createVolumeJob(mount, { label: 'MANUAL', generateThumbs: withThumbs }));
      console.log('[indexer]', 'manualScan enqueued', { type: 'volume', volumeUuid });
      return true;
    }

    if (type === 'manualRoot') {
      const root = (remoteStateCache.manualRoots || []).find((r) => `${r.id}` === `${rootId}`);
      if (!root) return false;

      scheduledQueue.enqueue(createManualRootJob(root, { label: 'MANUAL', generateThumbs: withThumbs }));
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
    (async () => {
      try {
        await upsertMountedVolumes(mounts);
        await refreshRemoteState();
        const activeSet = new Set(
          (remoteStateCache.volumes || []).filter((v) => v?.is_active !== 0).map((v) => v.volume_uuid)
        );
        const readyMounts = mounts.filter((m) => m.kind === 'volume' && activeSet.has(m.volume_uuid));
        readyMounts.forEach((m) => mountQueue.enqueue(createVolumeJob(m, { label: 'READY' })));
        if (readyMounts.length) {
          console.log('[indexer] ready scans queued', { count: readyMounts.length });
        }
      } catch (e) {
        console.error('[indexer] ready upsert failed', e?.message || e);
      }
    })();
  });

  watcher.on('mounted', async (mount) => {
    console.log('[mount] mounted', mount.mount_point, mount.volume_name || '');

    latestMounts = Array.from(new Map([...latestMounts, mount].map(m => [m.key, m])).values());
    mountedVolumeUuids = latestMounts.filter(m => m.kind === 'volume').map(m => m.volume_uuid);
    mountedMountPoints = latestMounts.map(m => m.mount_point);

    if (mount.kind !== 'volume') return;

    // Upsert volume record to remote
    if (mount.kind === 'volume') {
      const deviceId = getDeviceId();
      const volumeRecord = {
        volume_uuid: mount.volume_uuid,
        volume_name: mount.volume_name,
        mount_point_last: mount.mount_point,
        last_seen_at: isoNow(),
        is_active: 1,
        scan_interval_ms: 20 * 60 * 1000,
        device_id: deviceId
      };
      await upsertState({ deviceId, volumes: [volumeRecord], manualRoots: [], files: [] });
      await refreshRemoteState();
    }

    // Always scan on mount unless explicitly disabled
    const vol = (remoteStateCache.volumes || []).find((v) => v.volume_uuid === mount.volume_uuid);
    if (vol && vol.is_active !== 0) {
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
  setInterval(async () => {
    try {
      await refreshRemoteState();
      const dueVolumes = getDueVolumesFromState(remoteStateCache.volumes, {
        mountedVolumeUuids,
        onlyMounted: true
      });

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
      const dueRoots = getDueManualRootsFromState(remoteStateCache.manualRoots, { mountedMountPoints });
      for (const r of dueRoots) {
        scheduledQueue.enqueue(createManualRootJob(r, { label: 'SCHEDULED' }));
      }
    } catch (e) {
      console.error('[scheduler] error:', e);
    }
  }, 60 * 1000);
}

async function manualScan(payload) {
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
process.on('message', async (msg) => {
  if (msg?.cmd !== 'indexerStatus') console.log('[worker] received msg', msg);
  if (!msg || typeof msg !== 'object') return;

  if (msg.cmd === 'manualScan') {
    ensureStarted();
    let result = await manualScan(msg.payload);
    if (result === false) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      result = await manualScan(msg.payload);
      console.log('[worker] manualScan retry result', result);
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
