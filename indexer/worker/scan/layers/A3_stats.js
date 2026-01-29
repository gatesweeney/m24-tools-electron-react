// indexer/worker/scan/layers/A3_stats.js
const fs = require('fs');
const path = require('path');
const { maybeYield } = require('../util/throttle');

function nowIso() {
  return new Date().toISOString();
}

/**
 * Stats pass:
 * - Iterates files already discovered in DB (is_dir=0)
 * - lstat() each file path to capture size/mtime/ctime
 * - Yields regularly to avoid hogging IO
 * - If file missing (ENOENT), marks status='missing'
 */
async function runA3Stats({ db, volume, cancelToken, progress }) {
  const rootPath = volume.mount_point;
  const volumeUuid = volume.volume_uuid;

  progress?.({ stage: 'A3_stats_start', volume_uuid: volumeUuid, rootPath });

  // Pull file list from DB for this volume/root
  // (We keep it simple: stat everything with is_dir=0)
  const rows = db.prepare(`
    SELECT id, relative_path
    FROM files
    WHERE volume_uuid = ?
      AND root_path = ?
      AND is_dir = 0
  `).all(volumeUuid, rootPath);

  const updateOk = db.prepare(`
    UPDATE files
    SET size_bytes = ?,
        mtime = ?,
        ctime = ?,
        last_seen_at = ?,
        status = 'present'
    WHERE id = ?
  `);

  const markMissing = db.prepare(`
    UPDATE files
    SET last_seen_at = ?,
        status = 'missing'
    WHERE id = ?
  `);

  let processed = 0;
  let missing = 0;
  let errored = 0;

  const ts = nowIso();

  for (const r of rows) {
    if (cancelToken.cancelled) {
      progress?.({ stage: 'A3_stats_cancelled', volume_uuid: volumeUuid, processed, missing, errored });
      return;
    }

    const fullPath = path.join(rootPath, r.relative_path);

    try {
      const st = await fs.promises.lstat(fullPath);

      // seconds are fine + stable for DB
      const mtime = Math.floor(st.mtimeMs / 1000);
      const ctime = Math.floor(st.ctimeMs / 1000);
      const size = st.size;

      updateOk.run(size, mtime, ctime, ts, r.id);
    } catch (err) {
      // If unplug happens mid-pass, we’ll get EIO/ENOENT/etc.
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        markMissing.run(ts, r.id);
        missing++;
      } else if (err && (err.code === 'EIO' || err.code === 'EPERM' || err.code === 'EBUSY')) {
        // Don’t crash the whole scan; just count it.
        errored++;
      } else {
        errored++;
      }
    }

    processed++;
    if (processed % 1000 === 0) {
      progress?.({
        stage: 'A3_stats_progress',
        volume_uuid: volumeUuid,
        processed,
        total: rows.length,
        missing,
        errored
      });
    }

    await maybeYield(processed, { every: 500, ms: 10 });
  }

  // Update volumes.last_scan_at (fast scan completion marker)
  db.prepare(`
    UPDATE volumes
    SET last_scan_at = ?
    WHERE volume_uuid = ?
  `).run(nowIso(), volumeUuid);

  progress?.({
    stage: 'A3_stats_end',
    volume_uuid: volumeUuid,
    processed,
    total: rows.length,
    missing,
    errored
  });
}

module.exports = { runA3Stats };