const { openDb } = require('./db');
const {
  getMountedDrives,
  upsertDrive,
  getWatchedRoots,
  ensureAutoRootsForDrives
} = require('./drives');
const { scanRootQuick } = require('./scanner');
const { inferCameraForRoot } = require('./camera');
const { updateSearchIndexForRoot } = require('./searchIndex');
const { SCAN_INTERVAL_MS } = require('./config'); // if you still use this

async function runScanCycle(progressCb) {
  const report = (payload) => {
    if (typeof progressCb === 'function') {
      try {
        progressCb(payload);
      } catch (e) {
        console.error('[indexer] progressCb error:', e);
      }
    }
  };

  console.log('[indexer] Opening DB…');
  const db = openDb();
  const nowIso = new Date().toISOString();
  console.log('[indexer] DB opened at', nowIso);

  report({ stage: 'startCycle', timestamp: nowIso });

  console.log('[indexer] Getting mounted drives…');
  const drives = getMountedDrives();
  console.log('[indexer] Found', drives.length, 'drives');

  drives.forEach((d) => upsertDrive(db, d, nowIso));

  ensureAutoRootsForDrives(db);

  console.log('[indexer] Loading watched roots…');
  const roots = getWatchedRoots(db);
  console.log('[indexer] Found', roots.length, 'watched roots');

  report({
    stage: 'rootsLoaded',
    totalRoots: roots.length,
    timestamp: new Date().toISOString()
  });

  let index = 0;
  for (const root of roots) {
    const driveUuid = root.drive_uuid;
    const rootPath = root.root_path;
    const mode = root.deep_scan_mode || 'none';

    // (optional) per-root scheduling checks could go here…

    index++;
    report({
      stage: 'rootStart',
      rootPath,
      driveUuid,
      index,
      totalRoots: roots.length,
      timestamp: new Date().toISOString()
    });

    try {
      console.log(`[indexer] Quick scanning ${rootPath} (${driveUuid})`);
      await scanRootQuick(db, driveUuid, rootPath);

      // here you might do: inferCameraForRoot(db, driveUuid, rootPath);
      // and updateSearchIndexForRoot(db, driveUuid, rootPath);

      const nowIsoRoot = new Date().toISOString();
      db.prepare(`
        UPDATE watched_roots SET last_scan_at = ? WHERE id = ?
      `).run(nowIsoRoot, root.id);

      report({
        stage: 'rootEnd',
        rootPath,
        driveUuid,
        index,
        totalRoots: roots.length,
        timestamp: nowIsoRoot
      });
    } catch (err) {
      console.error(`[indexer] Error scanning ${rootPath}:`, err);
      report({
        stage: 'rootError',
        rootPath,
        driveUuid,
        index,
        totalRoots: roots.length,
        error: err.message || String(err),
        timestamp: new Date().toISOString()
      });
    }
  }

  console.log('[indexer] Closing DB…');
  db.close();
  const endIso = new Date().toISOString();
  console.log('[indexer] Scan cycle finished.');

  report({
    stage: 'endCycle',
    timestamp: endIso
  });
}

if (require.main === module) {
  runScanCycle().catch((err) => {
    console.error('[indexer] Fatal error in scan cycle:', err);
    process.exit(1);
  });
}

module.exports = {
  runScanCycle
};

if (require.main === module) {
  runScanCycle().catch((err) => {
    console.error('[indexer] Fatal error in scan cycle:', err);
    process.exit(1);
  });
}

module.exports = {
  runScanCycle
};