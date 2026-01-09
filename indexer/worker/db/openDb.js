// indexer/worker/db/openDb.js
const Database = require('better-sqlite3');
const { getDbPath, getMachineDir } = require('../config/paths');

function migrateToV1(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS volumes (
      volume_uuid      TEXT PRIMARY KEY,
      volume_name      TEXT,
      device_id        TEXT,
      size_bytes       INTEGER,
      fs_type          TEXT,
      mount_point_last TEXT,
      first_seen_at    TEXT,
      last_seen_at     TEXT,
      last_scan_at     TEXT,
      scan_interval_ms INTEGER DEFAULT 1200000, -- 20 min default
      is_active        INTEGER DEFAULT 1,
      auto_added       INTEGER DEFAULT 1,
      tags             TEXT,
      physical_location TEXT,
      notes            TEXT,
      signature        TEXT,
      signature_hint   TEXT, -- JSON
      thumb1_path      TEXT,
      thumb2_path      TEXT,
      thumb3_path      TEXT
    );

    CREATE TABLE IF NOT EXISTS manual_roots (
      id              INTEGER PRIMARY KEY,
      path            TEXT UNIQUE NOT NULL,
      label           TEXT,
      is_active       INTEGER DEFAULT 1,
      scan_interval_ms INTEGER DEFAULT NULL,
      last_scan_at    TEXT,
      notes           TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id            INTEGER PRIMARY KEY,
      volume_uuid   TEXT,
      root_path     TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      name          TEXT NOT NULL,
      ext           TEXT,
      is_dir        INTEGER NOT NULL,
      size_bytes    INTEGER,
      mtime         INTEGER,
      ctime         INTEGER,
      file_type     TEXT,
      last_seen_at  TEXT,
      status        TEXT NOT NULL DEFAULT 'present',
      UNIQUE(volume_uuid, root_path, relative_path)
    );

    CREATE INDEX IF NOT EXISTS files_name_idx ON files(name);
    CREATE INDEX IF NOT EXISTS files_status_idx ON files(status);

    CREATE TABLE IF NOT EXISTS media_metadata (
      id             INTEGER PRIMARY KEY,
      file_id        INTEGER NOT NULL UNIQUE,
      duration_sec   REAL,
      width          INTEGER,
      height         INTEGER,
      video_codec    TEXT,
      audio_codec    TEXT,
      audio_sample_rate INTEGER,
      audio_channels INTEGER,
      bitrate        INTEGER,
      format_name    TEXT,
      raw_json       TEXT,
      probed_at      TEXT,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS media_metadata_file_id_idx ON media_metadata(file_id);

    CREATE TABLE IF NOT EXISTS scan_runs (
      id              INTEGER PRIMARY KEY,
      target_type     TEXT NOT NULL, -- 'volume' | 'manual_root'
      target_id       TEXT NOT NULL, -- volume_uuid or manual_root id
      started_at      TEXT,
      finished_at     TEXT,
      status          TEXT,
      stage           TEXT,
      total_dirs      INTEGER,
      total_files     INTEGER,
      new_entries     INTEGER,
      changed_entries INTEGER,
      removed_entries INTEGER,
      error           TEXT
    );

    -- OffShoot and Foolcat stubs for later
    CREATE TABLE IF NOT EXISTS offshoot_jobs (
      id             TEXT PRIMARY KEY,
      volume_uuid    TEXT,
      log_path       TEXT,
      log_mtime      INTEGER,
      log_size       INTEGER,
      source_name    TEXT,
      dest_volume    TEXT,
      started_at     TEXT,
      finished_at    TEXT,
      total_files    INTEGER,
      total_bytes    INTEGER,
      hash_type      TEXT,
      verification_mode TEXT,
      status         TEXT,
      error_count    INTEGER,
      error_excerpt  TEXT,
      last_parsed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS foolcat_reports (
      id             TEXT PRIMARY KEY,
      volume_uuid    TEXT,
      report_name    TEXT,
      report_root    TEXT,
      report_js_path TEXT,
      created_at     TEXT,
      clip_count     INTEGER,
      duration_sec   REAL,
      total_bytes    INTEGER,
      thumb1_path    TEXT,
      thumb2_path    TEXT,
      thumb3_path    TEXT,
      last_parsed_at TEXT
    );

    PRAGMA user_version = 1;
  `);
}

function ensureColumns(db) {
  const cols = db.prepare(`PRAGMA table_info(scan_runs)`).all().map(r => r.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE scan_runs ADD COLUMN ${ddl}`); };

  add('duration_ms', 'duration_ms INTEGER');
  add('result', 'result TEXT'); // if you want separate from status

  // Ensure media_metadata table exists (for existing databases)
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_metadata (
      id             INTEGER PRIMARY KEY,
      file_id        INTEGER NOT NULL UNIQUE,
      duration_sec   REAL,
      width          INTEGER,
      height         INTEGER,
      video_codec    TEXT,
      audio_codec    TEXT,
      audio_sample_rate INTEGER,
      audio_channels INTEGER,
      bitrate        INTEGER,
      format_name    TEXT,
      raw_json       TEXT,
      probed_at      TEXT,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS media_metadata_file_id_idx ON media_metadata(file_id);
  `);

  // Transcriptions table for Whisper output
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id              INTEGER PRIMARY KEY,
      file_path       TEXT UNIQUE NOT NULL,
      text            TEXT,
      language        TEXT,
      duration_sec    REAL,
      transcribed_at  TEXT,
      model           TEXT
    );
    CREATE INDEX IF NOT EXISTS transcriptions_path_idx ON transcriptions(file_path);
  `);
}

function openDb() {
  const dbPath = getDbPath();
  const db = new Database(dbPath);

  const row = db.prepare('PRAGMA user_version').get();
  const version = row.user_version || 0;

  if (version === 0) {
    migrateToV1(db);
  }

  // Store machine_id in settings for reference
  const { machineId } = getMachineDir();
  db.prepare(`
    INSERT INTO settings(key, value) VALUES ('machine_id', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(machineId);

  ensureColumns(db);

  return db;
}

module.exports = { openDb };