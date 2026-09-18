// indexer/main.js
const { openDb } = require('./db');
const {
  getMountedDrives,
  upsertDrive,
  getWatchedRoots,
  ensureAutoRootsForDrives
} = require('./drives');
const { scanRootQuick /*, scanRootDeep, scanRootFlash */ } = require('./scanner');

async function runScanCycle() {
  console.log('[indexer] Opening DB…');
  const db = openDb();
  const nowIso = new Date().toISOString();
  console.log('[indexer] DB opened at', nowIso);

  console.log('[indexer] Getting mounted drives…');
  const drives = getMountedDrives();
  console.log('[indexer] Found', drives.length, 'drives');

  drives.forEach((d) => upsertDrive(db, d, nowIso));

  // Auto-create watched roots for eligible drives
  ensureAutoRootsForDrives(db);

  console.log('[indexer] Loading watched roots…');
  const roots = getWatchedRoots(db);
  console.log('[indexer] Found', roots.length, 'watched roots');

  for (const root of roots) {
  const driveUuid = root.drive_uuid;
  const rootPath = root.root_path;
  const mode = root.deep_scan_mode || 'none';

  // --- PER-ROOT SCHEDULING LOGIC ---
  const now = Date.now();

  // If interval is set:
  if (root.scan_interval_ms != null) {
    const interval = root.scan_interval_ms;

    // -1 means MANUAL ONLY (skip automatically)
    if (interval < 0) {
      console.log('[indexer] Skipping manual-only root:', rootPath);
      continue;
    }

    // If last scan time exists, enforce minimum delay
    if (root.last_scan_at) {
      const lastTime = Date.parse(root.last_scan_at);
      if (!Number.isNaN(lastTime)) {
        const elapsed = now - lastTime;
        if (elapsed < interval) {
          console.log(`[indexer] Skipping ${rootPath}, scanned ${elapsed}ms ago (< ${interval})`);
          continue;
        }
      }
    }
  }

  try {
    console.log(`[indexer] Quick scanning ${rootPath} (${driveUuid})`);
    await scanRootQuick(db, driveUuid, rootPath);

    // Save timestamp after successful scan
    const nowIsoRoot = new Date().toISOString();
    db.prepare(`
      UPDATE watched_roots SET last_scan_at = ? WHERE id = ?
    `).run(nowIsoRoot, root.id);

  } catch (err) {
    console.error(`[indexer] Error scanning ${rootPath}:`, err);
  }
}

  console.log('[indexer] Closing DB…');
  db.close();
  console.log('[indexer] Scan cycle finished.');
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