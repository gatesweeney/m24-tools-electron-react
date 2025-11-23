// indexer/uiApi.js
const { openDb } = require('./db');
const { getWatchedRoots } = require('./drives');
const { getMachineId } = require('./config');
const path = require('path');
const { ensureSearchIndex } = require('./searchIndex');
const { runScanCycle } = require('./main');

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
//
/**
 * Trigger a manual scan.
 * For now, we just run the whole scan cycle; later we can limit to a specific rootPath if desired.
 */
async function scanNow(rootPath) {
  console.log('[indexer-uiApi] scanNow requested for root:', rootPath || '(all)');
  await runScanCycle();
  return { ok: true };
}

/**
 * Add or re-activate a watched root for the given path.
 * - Finds the drive whose mount_point is a prefix of rootPath
 * - Inserts a row into watched_roots (or re-activates existing)
 * - Returns the updated indexer state
 */
async function addRoot(rootPath) {
  const db = openDb();
  const machineId = getMachineId();
  const nowIso = new Date().toISOString();

  // Find drive by mount point
  const drive = db.prepare(`
    SELECT volume_uuid, primary_name, mount_point
    FROM drives
    WHERE machine_id = ?
      AND ? LIKE (mount_point || '%')
    ORDER BY LENGTH(mount_point) DESC
    LIMIT 1
  `).get(machineId, rootPath);

  const driveUuid = drive?.volume_uuid || null;
  const label = path.basename(rootPath.replace(/\/$/, '')) || rootPath;

  const existing = db.prepare(`
    SELECT id FROM watched_roots
    WHERE drive_uuid IS ? AND root_path = ?
  `).get(driveUuid, rootPath);

  if (existing) {
    db.prepare(`
      UPDATE watched_roots
      SET is_active = 1
      WHERE id = ?
    `).run(existing.id);
  } else {
    db.prepare(`
      INSERT INTO watched_roots (
        drive_uuid, root_path, label,
        is_active, deep_scan_mode, scan_interval_ms, last_scan_at, priority
      ) VALUES (?, ?, ?, 1, 'none', NULL, NULL, 0)
    `).run(driveUuid, rootPath, label);
  }

  db.close();
  // Return updated drives + roots
  return await getIndexerState();
}

/**
 * Enable/disable a root by id.
 * - isActive: boolean
 */
async function setRootActive(rootId, isActive) {
  const db = openDb();
  db.prepare(`
    UPDATE watched_roots
    SET is_active = ?
    WHERE id = ?
  `).run(isActive ? 1 : 0, rootId);
  db.close();

  return await getIndexerState();
}



async function searchFiles(q, limit = 200) {
  const db = openDb();
  const machineId = getMachineId();
  const query = (q || '').trim().toLowerCase();

  if (!query) {
    db.close();
    return [];
  }

  ensureSearchIndex(db);

  const tokens = query.split(/\s+/).filter(Boolean);
  const ftsTokens = tokens
    .filter((t) => t.length >= 2)
    .map((t) => `${t}*`);

  let rows = [];

  if (ftsTokens.length > 0) {
    const matchExpr = ftsTokens.join(' ');

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

async function getFilesForRoot(rootId, limit = 1000) {
  const db = openDb();
  const machineId = getMachineId();

  const root = db.prepare(`
    SELECT drive_uuid, root_path
    FROM watched_roots
    WHERE id = ?
  `).get(rootId);

  if (!root) {
    db.close();
    return [];
  }

  const files = db.prepare(`
    SELECT
      id,
      name,
      ext,
      file_type,
      size_bytes,
      last_status,
      first_seen_at,
      last_seen_at,
      drive_uuid,
      root_path,
      relative_path
    FROM files
    WHERE machine_id = ?
      AND drive_uuid = ?
      AND root_path = ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(machineId, root.drive_uuid, root.root_path, limit);

  db.close();
  return files;
}

module.exports = {
  getIndexerState,
  scanNow,
  searchFiles,
  addRoot,
  setRootActive,
  getFilesForRoot,
  
};
