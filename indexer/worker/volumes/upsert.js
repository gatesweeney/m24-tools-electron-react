// indexer/worker/volumes/upsert.js
const { openDb } = require('../db/openDb');

function upsertVolume(mount) {
  const db = openDb();
  const now = new Date().toISOString();

  const row = db.prepare(`
    SELECT volume_uuid, is_active
    FROM volumes
    WHERE volume_uuid = ?
  `).get(mount.volume_uuid);

  if (!row) {
    db.prepare(`
      INSERT INTO volumes (
        volume_uuid,
        volume_name,
        size_bytes,
        fs_type,
        mount_point_last,
        first_seen_at,
        last_seen_at,
        last_scan_at,
        is_active,
        auto_added
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 1)
    `).run(
      mount.volume_uuid,
      mount.volume_name,
      mount.size_bytes,
      mount.fs_type,
      mount.mount_point,
      now,
      now
    );
  } else {
    db.prepare(`
      UPDATE volumes
      SET
        volume_name = ?,
        size_bytes = ?,
        fs_type = ?,
        mount_point_last = ?,
        last_seen_at = ?
      WHERE volume_uuid = ?
    `).run(
      mount.volume_name,
      mount.size_bytes,
      mount.fs_type,
      mount.mount_point,
      now,
      mount.volume_uuid
    );
  }

  const updated = db.prepare(`
    SELECT volume_uuid, is_active
    FROM volumes
    WHERE volume_uuid = ?
  `).get(mount.volume_uuid);

  db.close();
  return updated;
}

module.exports = { upsertVolume };