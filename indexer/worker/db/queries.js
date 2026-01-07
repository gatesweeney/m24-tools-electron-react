// indexer/worker/db/queries.js
const { openDb } = require('./openDb');

function getIndexerState() {
  const db = openDb();

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
  // For volumes: root_path = mount_point_last
  // For manual roots: we used volume_uuid = 'manual:<id>' and root_path = root path
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

const drivesWithRun = drivesWithStats.map(d => {
  const r = runMap.get(`volume:${d.volume_uuid}`);
  return { ...d, last_run_status: r?.status || null, last_run_duration_ms: r?.duration_ms || null };
});

const rootsWithRun = rootsWithStats.map(r => {
  const rr = runMap.get(`manualRoot:${r.id}`);
  return { ...r, last_run_status: rr?.status || null, last_run_duration_ms: rr?.duration_ms || null };
});

  db.close();
  return { drives: drivesWithRun, roots: rootsWithRun };
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

module.exports = {
  getIndexerState,
  setVolumeActive,
  setVolumeInterval,
  addManualRoot,
  setManualRootActive,
  setManualRootInterval,
  removeManualRoot
};