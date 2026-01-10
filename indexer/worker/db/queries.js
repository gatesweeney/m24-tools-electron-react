// indexer/worker/db/queries.js
const { openDb } = require('./openDb');
const { getMergedIndexerState } = require('./merge');

function getLocalIndexerState() {
  const db = openDb();
  const machineRow = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('machine_id');
  const machineNameRow = db.prepare(`SELECT value FROM settings WHERE key = ?`).get('machine_name');
  const machineId = machineRow?.value || 'local';
  const machineName = machineNameRow?.value || machineId;

  const drives = db.prepare(`
    SELECT *
    FROM volumes
    ORDER BY COALESCE(last_scan_at, '1970-01-01') DESC
  `).all();

  const roots = db.prepare(`
    SELECT *
    FROM manual_roots
    ORDER BY COALESCE(last_scan_at, '1970-01-01') DESC
  `).all();

  // Aggregate file stats per (volume_uuid, root_path)
  const statsByKey = new Map();

  const statsRows = db.prepare(`
    SELECT
      volume_uuid,
      root_path,
      SUM(CASE WHEN is_dir=0 THEN 1 ELSE 0 END) AS file_count,
      SUM(CASE WHEN is_dir=1 THEN 1 ELSE 0 END) AS dir_count,
      SUM(CASE WHEN is_dir=0 THEN COALESCE(size_bytes, 0) ELSE 0 END) AS total_bytes
    FROM files
    GROUP BY volume_uuid, root_path
  `).all();

  for (const r of statsRows) {
    statsByKey.set(`${r.volume_uuid}||${r.root_path}`, {
      file_count: r.file_count || 0,
      dir_count: r.dir_count || 0,
      total_bytes: r.total_bytes || 0
    });
  }

  // Attach stats onto drives
  const drivesWithStats = drives.map((d) => {
    const key = `${d.volume_uuid}||${d.mount_point_last || ''}`;
    const s = statsByKey.get(key) || { file_count: 0, dir_count: 0, total_bytes: 0 };
    return { ...d, ...s };
  });

  // Attach stats onto manual roots (we scan them using volume_uuid = manual:<id>)
  const rootsWithStats = roots.map((r) => {
    const v = `manual:${r.id}`;
    const key = `${v}||${r.path}`;
    const s = statsByKey.get(key) || { file_count: 0, dir_count: 0, total_bytes: 0 };
    return { ...r, ...s };
  });

  // Latest scan run per target
  const lastRuns = db.prepare(`
    SELECT sr.*
    FROM scan_runs sr
    JOIN (
      SELECT target_type, target_id, MAX(id) AS max_id
      FROM scan_runs
      GROUP BY target_type, target_id
    ) latest
    ON sr.id = latest.max_id
  `).all();

  const runMap = new Map();
  for (const r of lastRuns) {
    runMap.set(`${r.target_type}:${r.target_id}`, r);
  }

  const drivesWithRun = drivesWithStats.map((d) => {
    const r = runMap.get(`volume:${d.volume_uuid}`);
    return {
      ...d,
      last_run_status: r?.status || null,
      last_run_duration_ms: r?.duration_ms || null,
      seen_on: [machineName],
      seen_count: 1
    };
  });

  const rootsWithRun = rootsWithStats.map((r) => {
    const rr = runMap.get(`manualRoot:${r.id}`);
    return {
      ...r,
      last_run_status: rr?.status || null,
      last_run_duration_ms: rr?.duration_ms || null,
      seen_on: [machineId],
      seen_count: 1
    };
  });

  db.close();
  return { drives: drivesWithRun, roots: rootsWithRun };
}

function getIndexerState() {
  if (process.env.M24_MERGE_STATE === '1') {
    return getMergedIndexerState();
  }
  return getLocalIndexerState();
}

function setVolumeActive(volumeUuid, isActive) {
  const db = openDb();
  db.prepare(`
    UPDATE volumes
    SET is_active = ?
    WHERE volume_uuid = ?
  `).run(isActive ? 1 : 0, volumeUuid);
  db.close();
  return getIndexerState();
}

function setVolumeInterval(volumeUuid, intervalMs) {
  const db = openDb();
  db.prepare(`
    UPDATE volumes
    SET scan_interval_ms = ?
    WHERE volume_uuid = ?
  `).run(intervalMs, volumeUuid);
  db.close();
  return getIndexerState();
}

function setVolumeAutoPurge(volumeUuid, enabled) {
  const db = openDb();
  db.prepare(`
    UPDATE volumes
    SET auto_purge = ?
    WHERE volume_uuid = ?
  `).run(enabled ? 1 : 0, volumeUuid);
  db.close();
  return getIndexerState();
}

function addManualRoot(rootPath) {
  const db = openDb();
  const label = rootPath.split('/').filter(Boolean).pop() || rootPath;

  db.prepare(`
    INSERT INTO manual_roots (path, label, is_active, scan_interval_ms, last_scan_at, notes)
    VALUES (?, ?, 1, NULL, NULL, NULL)
    ON CONFLICT(path) DO UPDATE SET is_active=1, label=excluded.label
  `).run(rootPath, label);

  db.close();
  return getIndexerState();
}

function setManualRootActive(rootId, isActive) {
  const db = openDb();
  db.prepare(`
    UPDATE manual_roots
    SET is_active = ?
    WHERE id = ?
  `).run(isActive ? 1 : 0, rootId);
  db.close();
  return getIndexerState();
}

function setManualRootInterval(rootId, intervalMs) {
  const db = openDb();
  db.prepare(`
    UPDATE manual_roots
    SET scan_interval_ms = ?
    WHERE id = ?
  `).run(intervalMs, rootId);
  db.close();
  return getIndexerState();
}

function removeManualRoot(rootId) {
  const db = openDb();
  db.prepare(`DELETE FROM manual_roots WHERE id = ?`).run(rootId);
  db.close();
  return getIndexerState();
}

function disableVolume(volumeUuid) {
  const db = openDb();
  db.prepare(`
    UPDATE volumes
    SET is_active = 0
    WHERE volume_uuid = ?
  `).run(volumeUuid);
  db.close();
  return getIndexerState();
}

function disableAndDeleteVolumeData(volumeUuid) {
  const db = openDb();

  const thumbs = db.prepare(`
    SELECT thumb1_path, thumb2_path, thumb3_path
    FROM volumes
    WHERE volume_uuid = ?
  `).get(volumeUuid);

  db.prepare(`
    UPDATE volumes
    SET is_active = 0
    WHERE volume_uuid = ?
  `).run(volumeUuid);

  db.prepare(`DELETE FROM files WHERE volume_uuid = ?`).run(volumeUuid);
  db.prepare(`
    DELETE FROM scan_runs
    WHERE target_type = 'volume' AND target_id = ?
  `).run(volumeUuid);
  db.prepare(`DELETE FROM offshoot_jobs WHERE volume_uuid = ?`).run(volumeUuid);
  db.prepare(`DELETE FROM foolcat_reports WHERE volume_uuid = ?`).run(volumeUuid);

  const thumbPaths = [thumbs?.thumb1_path, thumbs?.thumb2_path, thumbs?.thumb3_path].filter(Boolean);
  for (const p of thumbPaths) {
    try { require('fs').unlinkSync(p); } catch {}
  }

  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
  try { db.exec('VACUUM;'); } catch {}

  db.close();
  return getIndexerState();
}

function disableManualRoot(rootId) {
  const db = openDb();
  db.prepare(`
    UPDATE manual_roots
    SET is_active = 0
    WHERE id = ?
  `).run(rootId);
  db.close();
  return getIndexerState();
}

function disableAndDeleteManualRootData(rootId) {
  const db = openDb();
  const root = db.prepare(`SELECT path FROM manual_roots WHERE id = ?`).get(rootId);
  if (!root) {
    db.close();
    return getIndexerState();
  }

  const volumeUuid = `manual:${rootId}`;
  const rootPath = root.path;

  db.prepare(`
    UPDATE manual_roots
    SET is_active = 0
    WHERE id = ?
  `).run(rootId);

  db.prepare(`
    DELETE FROM files
    WHERE volume_uuid = ? AND root_path = ?
  `).run(volumeUuid, rootPath);

  db.prepare(`
    DELETE FROM scan_runs
    WHERE target_type = 'manualRoot' AND target_id = ?
  `).run(rootId);

  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
  try { db.exec('VACUUM;'); } catch {}

  db.close();
  return getIndexerState();
}

function getManualRootById(rootId) {
  const db = openDb();
  const root = db.prepare(`SELECT * FROM manual_roots WHERE id = ?`).get(rootId);
  db.close();
  return root || null;
}

function getSetting(key) {
  const db = openDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  db.close();
  return row ? row.value : null;
}

function getVolumeByUuid(volumeUuid) {
  const db = openDb();
  const vol = db.prepare(`SELECT * FROM volumes WHERE volume_uuid = ?`).get(volumeUuid);
  db.close();
  return vol || null;
}

function getVolumeThumbPaths() {
  const db = openDb();
  const rows = db.prepare(`
    SELECT thumb1_path, thumb2_path, thumb3_path
    FROM volumes
  `).all();
  db.close();
  const out = [];
  for (const r of rows) {
    if (r.thumb1_path) out.push(r.thumb1_path);
    if (r.thumb2_path) out.push(r.thumb2_path);
    if (r.thumb3_path) out.push(r.thumb3_path);
  }
  return out;
}

function purgeFilesOlderThan(cutoffIso) {
  const db = openDb();
  const res = db.prepare(`
    DELETE FROM files
    WHERE volume_uuid IN (SELECT volume_uuid FROM volumes WHERE auto_purge = 1)
      AND last_seen_at IS NOT NULL
      AND last_seen_at < ?
  `).run(cutoffIso);
  db.close();
  return res.changes || 0;
}

function setSetting(key, value) {
  const db = openDb();
  db.prepare(`
    INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, value);
  db.close();
  return { ok: true };
}

/**
 * Get immediate children of a directory.
 * Used for Finder column-view navigation in search results.
 */
function getDirectoryContents(volumeUuid, rootPath, dirRelativePath) {
  const db = openDb();

  // For root of volume, dirRelativePath might be empty or '.'
  const prefix = (!dirRelativePath || dirRelativePath === '.' || dirRelativePath === '')
    ? ''
    : `${dirRelativePath}/`;

  // Get immediate children (files/dirs directly in this folder, not nested)
  // Pattern: prefix% matches all descendants
  // NOT LIKE prefix%/% excludes nested items (only immediate children)
  let rows;
  if (prefix === '') {
    // Root level - get items with no slash in relative_path
    rows = db.prepare(`
      SELECT
        f.*,
        m.duration_sec, m.width, m.height, m.video_codec, m.audio_codec, m.format_name,
        CASE
          WHEN f.is_dir = 1 THEN
            CASE
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'error'
              ) THEN 'error'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'warn'
              ) THEN 'warn'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'ok'
              ) THEN 'ok'
              ELSE NULL
            END
          ELSE of.status
        END AS offshoot_status,
        CASE
          WHEN f.is_dir = 1 THEN (
            SELECT message FROM offshoot_files of
            WHERE of.volume_uuid = f.volume_uuid
              AND of.root_path = f.root_path
              AND of.relative_path LIKE f.relative_path || '/%'
              AND of.status IN ('error', 'warn')
            LIMIT 1
          )
          ELSE of.message
        END AS offshoot_message
      FROM files f
      LEFT JOIN media_metadata m ON m.file_id = f.id
      LEFT JOIN offshoot_files of ON
        of.volume_uuid = f.volume_uuid AND of.root_path = f.root_path AND of.relative_path = f.relative_path
      WHERE f.volume_uuid = ?
        AND f.root_path = ?
        AND f.relative_path NOT LIKE '%/%'
        AND f.relative_path != ''
      ORDER BY f.is_dir DESC, f.name ASC
      LIMIT 500
    `).all(volumeUuid, rootPath);
  } else {
    rows = db.prepare(`
      SELECT
        f.*,
        m.duration_sec, m.width, m.height, m.video_codec, m.audio_codec, m.format_name,
        CASE
          WHEN f.is_dir = 1 THEN
            CASE
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'error'
              ) THEN 'error'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'warn'
              ) THEN 'warn'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'ok'
              ) THEN 'ok'
              ELSE NULL
            END
          ELSE of.status
        END AS offshoot_status,
        CASE
          WHEN f.is_dir = 1 THEN (
            SELECT message FROM offshoot_files of
            WHERE of.volume_uuid = f.volume_uuid
              AND of.root_path = f.root_path
              AND of.relative_path LIKE f.relative_path || '/%'
              AND of.status IN ('error', 'warn')
            LIMIT 1
          )
          ELSE of.message
        END AS offshoot_message
      FROM files f
      LEFT JOIN media_metadata m ON m.file_id = f.id
      LEFT JOIN offshoot_files of ON
        of.volume_uuid = f.volume_uuid AND of.root_path = f.root_path AND of.relative_path = f.relative_path
      WHERE f.volume_uuid = ?
        AND f.root_path = ?
        AND f.relative_path LIKE ?
        AND f.relative_path NOT LIKE ?
      ORDER BY f.is_dir DESC, f.name ASC
      LIMIT 500
    `).all(volumeUuid, rootPath, `${prefix}%`, `${prefix}%/%`);
  }

  db.close();

  // Normalize rows to include full path
  return rows.map(r => ({
    ...r,
    is_dir: !!r.is_dir,
    path: rootPath ? `${rootPath}/${r.relative_path}`.replace(/\/+/g, '/') : r.relative_path
  }));
}

/**
 * Get all descendants of a directory (recursive).
 * Used for recursive filtering in the detail panel.
 */
function getDirectoryContentsRecursive(volumeUuid, rootPath, dirRelativePath, limit = 250, offset = 0) {
  const db = openDb();

  const prefix = (!dirRelativePath || dirRelativePath === '.' || dirRelativePath === '')
    ? ''
    : `${dirRelativePath}/`;

  let rows;
  if (prefix === '') {
    rows = db.prepare(`
      SELECT
        f.*,
        m.duration_sec, m.width, m.height, m.video_codec, m.audio_codec, m.format_name,
        CASE
          WHEN f.is_dir = 1 THEN
            CASE
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'error'
              ) THEN 'error'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'warn'
              ) THEN 'warn'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'ok'
              ) THEN 'ok'
              ELSE NULL
            END
          ELSE of.status
        END AS offshoot_status,
        CASE
          WHEN f.is_dir = 1 THEN (
            SELECT message FROM offshoot_files of
            WHERE of.volume_uuid = f.volume_uuid
              AND of.root_path = f.root_path
              AND of.relative_path LIKE f.relative_path || '/%'
              AND of.status IN ('error', 'warn')
            LIMIT 1
          )
          ELSE of.message
        END AS offshoot_message
      FROM files f
      LEFT JOIN media_metadata m ON m.file_id = f.id
      LEFT JOIN offshoot_files of ON
        of.volume_uuid = f.volume_uuid AND of.root_path = f.root_path AND of.relative_path = f.relative_path
      WHERE f.volume_uuid = ?
        AND f.root_path = ?
        AND f.relative_path != ''
      ORDER BY f.is_dir DESC, f.name ASC
      LIMIT ?
      OFFSET ?
    `).all(volumeUuid, rootPath, limit, offset);
  } else {
    rows = db.prepare(`
      SELECT
        f.*,
        m.duration_sec, m.width, m.height, m.video_codec, m.audio_codec, m.format_name,
        CASE
          WHEN f.is_dir = 1 THEN
            CASE
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'error'
              ) THEN 'error'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'warn'
              ) THEN 'warn'
              WHEN EXISTS (
                SELECT 1 FROM offshoot_files of
                WHERE of.volume_uuid = f.volume_uuid
                  AND of.root_path = f.root_path
                  AND of.relative_path LIKE f.relative_path || '/%'
                  AND of.status = 'ok'
              ) THEN 'ok'
              ELSE NULL
            END
          ELSE of.status
        END AS offshoot_status,
        CASE
          WHEN f.is_dir = 1 THEN (
            SELECT message FROM offshoot_files of
            WHERE of.volume_uuid = f.volume_uuid
              AND of.root_path = f.root_path
              AND of.relative_path LIKE f.relative_path || '/%'
              AND of.status IN ('error', 'warn')
            LIMIT 1
          )
          ELSE of.message
        END AS offshoot_message
      FROM files f
      LEFT JOIN media_metadata m ON m.file_id = f.id
      LEFT JOIN offshoot_files of ON
        of.volume_uuid = f.volume_uuid AND of.root_path = f.root_path AND of.relative_path = f.relative_path
      WHERE f.volume_uuid = ?
        AND f.root_path = ?
        AND f.relative_path LIKE ?
      ORDER BY f.is_dir DESC, f.name ASC
      LIMIT ?
      OFFSET ?
    `).all(volumeUuid, rootPath, `${prefix}%`, limit, offset);
  }

  db.close();

  return rows.map(r => ({
    ...r,
    is_dir: !!r.is_dir,
    path: rootPath ? `${rootPath}/${r.relative_path}`.replace(/\/+/g, '/') : r.relative_path
  }));
}

/**
 * Get stats for a directory (file count, total size, etc.)
 */
function getDirectoryStats(volumeUuid, rootPath, dirRelativePath) {
  const db = openDb();

  const prefix = (!dirRelativePath || dirRelativePath === '.' || dirRelativePath === '')
    ? ''
    : `${dirRelativePath}/`;

  let stats;
  if (prefix === '') {
    stats = db.prepare(`
      SELECT
        COUNT(CASE WHEN is_dir = 0 THEN 1 END) AS file_count,
        COUNT(CASE WHEN is_dir = 1 THEN 1 END) AS dir_count,
        SUM(CASE WHEN is_dir = 0 THEN COALESCE(size_bytes, 0) ELSE 0 END) AS total_bytes
      FROM files
      WHERE volume_uuid = ?
        AND root_path = ?
    `).get(volumeUuid, rootPath);
  } else {
    stats = db.prepare(`
      SELECT
        COUNT(CASE WHEN is_dir = 0 THEN 1 END) AS file_count,
        COUNT(CASE WHEN is_dir = 1 THEN 1 END) AS dir_count,
        SUM(CASE WHEN is_dir = 0 THEN COALESCE(size_bytes, 0) ELSE 0 END) AS total_bytes
      FROM files
      WHERE volume_uuid = ?
        AND root_path = ?
        AND relative_path LIKE ?
    `).get(volumeUuid, rootPath, `${prefix}%`);
  }

  db.close();
  return stats || { file_count: 0, dir_count: 0, total_bytes: 0 };
}

module.exports = {
  getIndexerState,
  getLocalIndexerState,
  setVolumeActive,
  setVolumeInterval,
  setVolumeAutoPurge,
  addManualRoot,
  setManualRootActive,
  setManualRootInterval,
  removeManualRoot,
  disableVolume,
  disableAndDeleteVolumeData,
  disableManualRoot,
  disableAndDeleteManualRootData,
  getManualRootById,
  getSetting,
  setSetting,
  getVolumeByUuid,
  getVolumeThumbPaths,
  purgeFilesOlderThan,
  getDirectoryContents,
  getDirectoryContentsRecursive,
  getDirectoryStats
};
