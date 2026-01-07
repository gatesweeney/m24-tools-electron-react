// indexer/uiApi.js
const { openDb } = require('./db');
const { getWatchedRoots } = require('./drives');
const { getMachineId } = require('./config');
const { runScanCycle } = require('./main');
const { ensureSearchIndex } = require('./searchIndex');

/**
 * Return an overview of drives + watched roots for the UI.
 */
async function getIndexerState() {
  const db = openDb();
  const machineId = getMachineId();

  const drives = db.prepare(`
    SELECT
      id,
      machine_id,
      hardware_serial,
      device_model,
      volume_uuid,
      primary_name,
      seen_names,
      mount_point,
      fs_type,
      size_bytes,
      protocol,
      rotation_rate,
      smart_status,
      first_seen_at,
      last_seen_at,
      last_scan_at,
      total_bytes_written_logical,
      location_note,
      tags
    FROM drives
    WHERE machine_id = ?
    ORDER BY primary_name
  `).all(machineId);

  const roots = db.prepare(`
    SELECT
      id,
      drive_uuid,
      root_path,
      label,
      is_active,
      deep_scan_mode,
      scan_interval_ms,
      last_scan_at,
      priority
    FROM watched_roots
    ORDER BY root_path
  `).all();

  db.close();

  return { drives, roots };
}

/**
 * Trigger a manual scan.
 * For now, we just run the whole scan cycle; later we can limit to a specific rootPath if desired.
 */
async function scanNow(rootPath) {
  console.log('[indexer-uiApi] scanNow requested for root:', rootPath || '(all)');
  await runScanCycle();
  return { ok: true };
}


async function searchFiles(q, limit = 200) {
  const db = openDb();
  const machineId = getMachineId();
  const query = (q || '').trim().toLowerCase();

  if (!query) {
    db.close();
    return [];
  }

  // Make sure FTS index exists and is populated
  ensureSearchIndex(db);

  const tokens = query.split(/\s+/).filter(Boolean);
  const ftsTokens = tokens
    .filter((t) => t.length >= 2)
    .map((t) => `${t}*`); // prefix wildcard: a007* / venice* / mxf*

  let rows = [];

  if (ftsTokens.length > 0) {
    const matchExpr = ftsTokens.join(' '); // AND all terms

    try {
      rows = db.prepare(`
        SELECT
          f.id,
          f.name,
          f.ext,
          f.file_type,
          f.size_bytes,
          f.last_status,
          f.first_seen_at,
          f.last_seen_at,
          f.drive_uuid,
          f.root_path,
          f.relative_path,
          d.primary_name AS drive_name
        FROM file_search
        JOIN files f ON file_search.rowid = f.id
        LEFT JOIN drives d
          ON d.machine_id = f.machine_id
         AND d.volume_uuid = f.drive_uuid
        WHERE f.machine_id = ?
          AND file_search MATCH ?
        ORDER BY f.last_seen_at DESC
        LIMIT ?
      `).all(machineId, matchExpr, limit);
    } catch (err) {
      console.error('[fts] search failed, falling back to LIKE:', err);
      rows = [];
    }
  }

  // Fallback to LIKE if FTS yields nothing or errors
  if (rows.length === 0) {
    const pattern = `%${query}%`;
    rows = db.prepare(`
      SELECT
        f.id,
        f.name,
        f.ext,
        f.file_type,
        f.size_bytes,
        f.last_status,
        f.first_seen_at,
        f.last_seen_at,
        f.drive_uuid,
        f.root_path,
        f.relative_path,
        d.primary_name AS drive_name
      FROM files f
      LEFT JOIN drives d
        ON d.machine_id = f.machine_id
       AND d.volume_uuid = f.drive_uuid
      WHERE f.machine_id = ?
        AND (LOWER(f.name) LIKE ? OR LOWER(f.relative_path) LIKE ?)
      ORDER BY f.last_seen_at DESC
      LIMIT ?
    `).all(machineId, pattern, pattern, limit);
  }

  db.close();
  return rows;
}

module.exports = {
  getIndexerState,
  scanNow,
  searchFiles
};
