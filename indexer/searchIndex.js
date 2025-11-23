// indexer/searchIndex.js
const { getMachineId } = require('./config');

/**
 * Ensure file_search exists and is populated with basic data from files/drives/roots.
 * Call this before doing FTS-based search.
 */
function ensureSearchIndex(db) {
  // Make sure table exists (safe to call repeatedly)
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

  // Check if index empty; if so, bulk-populate from files
  const machineId = getMachineId();

  const countFiles = db.prepare(`
    SELECT COUNT(*) AS c FROM files WHERE machine_id = ?
  `).get(machineId).c;

  const countIndexed = db.prepare(`
    SELECT COUNT(*) AS c FROM file_search
  `).get().c;

  if (countFiles > 0 && countIndexed === 0) {
    console.log('[fts] file_search is empty; rebuilding from files…');
    rebuildSearchIndex(db, machineId);
  }
}

/**
 * Rebuild file_search FTS index from files + drives + roots.
 */
function rebuildSearchIndex(db, machineId) {
  db.prepare('DELETE FROM file_search').run();

  const rows = db.prepare(`
    SELECT
      f.id,
      f.name,
      f.ext,
      f.relative_path,
      f.root_path,
      d.primary_name AS drive_name,
      r.label AS root_label
    FROM files f
    LEFT JOIN drives d
      ON d.machine_id = f.machine_id
     AND d.volume_uuid = f.drive_uuid
    LEFT JOIN watched_roots r
      ON r.drive_uuid = f.drive_uuid
     AND r.root_path = f.root_path
    WHERE f.machine_id = ?
  `).all(machineId);

  const insert = db.prepare(`
    INSERT INTO file_search (rowid, name, path, drive, root_label, camera, ext)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const cameraPlaceholder = ''; // to be filled later once we have camera detection

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
      cameraPlaceholder,
      row.ext || ''
    );
    count++;
  }

  console.log(`[fts] Rebuilt file_search with ${count} rows.`);
}

module.exports = {
  ensureSearchIndex,
  rebuildSearchIndex
};