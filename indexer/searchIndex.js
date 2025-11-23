// indexer/searchIndex.js
const { getMachineId } = require('./config');

/**
 * Ensure FTS table exists (safe to call repeatedly).
 */
function ensureSearchTable(db) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS file_search
    USING fts5(
      name,
      path,
      drive,
      root_label,
      camera,
      ext
    );
  `);
}

/**
 * Rebuild FTS index rows for a specific root.
 * This keeps file_search in sync after each scanRootQuick.
 */
function updateSearchIndexForRoot(db, driveUuid, rootPath) {
  ensureSearchTable(db);
  const machineId = getMachineId();

  console.log('[fts] Updating index for root:', driveUuid, rootPath);

  // Remove any existing entries for this root
  db.prepare(`
    DELETE FROM file_search
    WHERE rowid IN (
      SELECT id FROM files
      WHERE machine_id = ?
        AND drive_uuid = ?
        AND root_path = ?
    )
  `).run(machineId, driveUuid, rootPath);

  // Insert fresh rows
  const rows = db.prepare(`
    SELECT
      f.id,
      f.name,
      f.ext,
      f.relative_path,
      f.root_path,
      d.primary_name AS drive_name,
      r.label AS root_label,
      c.camera_name AS camera_name
    FROM files f
    LEFT JOIN drives d
      ON d.machine_id = f.machine_id
     AND d.volume_uuid = f.drive_uuid
    LEFT JOIN watched_roots r
      ON r.drive_uuid = f.drive_uuid
     AND r.root_path = f.root_path
    LEFT JOIN root_camera_info c
      ON c.drive_uuid = f.drive_uuid
     AND c.root_path = f.root_path
    WHERE f.machine_id = ?
      AND f.drive_uuid = ?
      AND f.root_path = ?
  `).all(machineId, driveUuid, rootPath);

  const insert = db.prepare(`
    INSERT INTO file_search (rowid, name, path, drive, root_label, camera, ext)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const row of rows) {
    const fullPath = row.root_path
      ? `${row.root_path.replace(/\/$/, '')}/${row.relative_path}`
      : row.relative_path;

    insert.run(
      row.id,
      row.name || '',
      fullPath || '',
      row.drive_name || '',
      row.root_label || '',
      row.camera_name || '',
      row.ext || ''
    );
    count++;
  }

  console.log('[fts] Indexed', count, 'rows for root', rootPath);
}

/**
 * For searchFiles: ensure FTS is at least created.
 */
function ensureSearchIndex(db) {
  ensureSearchTable(db);
}

module.exports = {
  ensureSearchIndex,
  updateSearchIndexForRoot
};