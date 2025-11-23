// indexer/db.js
const Database = require('better-sqlite3');
const { getDbPath, getMachineId } = require('./config');

function openDb() {
  const dbPath = getDbPath();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const row = db.prepare('PRAGMA user_version').get();
  let version = row.user_version || 0;

  if (version === 0) {
    migrateToV1(db);
    version = 1;
  }

  // More migrations (v2, v3, etc.) would go here later if needed.

  return db;
}

function migrateToV1(db) {
  db.exec(`
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT INTO settings (key, value)
    VALUES ('machine_id', '${getMachineId()}'),
           ('machine_name', '${getMachineId()}'),
           ('schema_version', '1');

    CREATE TABLE drives (
      id                INTEGER PRIMARY KEY,
      machine_id        TEXT NOT NULL,
      hardware_serial   TEXT,
      device_model      TEXT,
      volume_uuid       TEXT,
      primary_name      TEXT,
      seen_names        TEXT,
      mount_point       TEXT,
      fs_type           TEXT,
      size_bytes        INTEGER,
      protocol          TEXT,
      rotation_rate     INTEGER,
      smart_status      TEXT,
      first_seen_at     TEXT,
      last_seen_at      TEXT,
      last_scan_at      TEXT,
      total_bytes_written_logical INTEGER DEFAULT 0,
      location_note     TEXT,
      tags              TEXT,
      raw_diskutil_info TEXT
    );
    CREATE UNIQUE INDEX drives_unique ON drives(machine_id, volume_uuid);

    CREATE TABLE watched_roots (
      id              INTEGER PRIMARY KEY,
      drive_uuid      TEXT,
      root_path       TEXT NOT NULL,
      label           TEXT,
      is_active       INTEGER NOT NULL DEFAULT 1,
      deep_scan_mode  TEXT NOT NULL DEFAULT 'none',  -- 'none' | 'quick' | 'deep' | 'flash'
      scan_interval_ms  INTEGER DEFAULT NULL,        -- null = global; >0=ms; <0=manual-only
      last_scan_at      TEXT,
      priority        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX roots_drive_path ON watched_roots(drive_uuid, root_path);

    CREATE TABLE files (
      id              INTEGER PRIMARY KEY,
      machine_id      TEXT NOT NULL,
      drive_uuid      TEXT NOT NULL,
      root_path       TEXT NOT NULL,
      relative_path   TEXT NOT NULL,
      name            TEXT NOT NULL,
      ext             TEXT,
      is_dir          INTEGER NOT NULL,
      size_bytes      INTEGER,
      mtime           INTEGER,
      ctime           INTEGER,
      file_type       TEXT,
      first_seen_at   TEXT,
      last_seen_at    TEXT,
      last_status     TEXT NOT NULL,
      deleted_at      TEXT,
      hash            TEXT,
      hash_type       TEXT
    );
    CREATE UNIQUE INDEX files_key ON files(machine_id, drive_uuid, root_path, relative_path);
    CREATE INDEX files_name_idx ON files(name);
    CREATE INDEX files_status_idx ON files(last_status);

    CREATE TABLE scans (
      id              INTEGER PRIMARY KEY,
      machine_id      TEXT NOT NULL,
      drive_uuid      TEXT,
      root_path       TEXT,
      started_at      TEXT,
      finished_at     TEXT,
      status          TEXT,
      total_files     INTEGER,
      total_dirs      INTEGER,
      new_entries     INTEGER,
      removed_entries INTEGER,
      changed_entries INTEGER
    );

    -- NEW: per-root camera detection
    CREATE TABLE root_camera_info (
      id          INTEGER PRIMARY KEY,
      drive_uuid  TEXT,
      root_path   TEXT,
      camera_name TEXT,
      confidence  REAL,
      details     TEXT
    );
    CREATE UNIQUE INDEX root_camera_unique ON root_camera_info(drive_uuid, root_path);

    -- NEW: FTS5 table for search
    CREATE VIRTUAL TABLE IF NOT EXISTS file_search
    USING fts5(
      name,
      path,
      drive,
      root_label,
      camera,
      ext
    );

    PRAGMA user_version = 1;
  `);
}

module.exports = {
  openDb
};