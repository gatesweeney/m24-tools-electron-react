// indexer/worker/db/settingsDb.js
const Database = require('better-sqlite3');
const os = require('os');
const { getSettingsDbPath, getMachineDir } = require('../config/paths');

function openSettingsDb() {
  const db = new Database(getSettingsDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS transcriptions (
      file_path TEXT PRIMARY KEY,
      text TEXT,
      language TEXT,
      duration_sec REAL,
      transcribed_at TEXT,
      model TEXT
    );
  `);

  const { machineId } = getMachineDir();
  const machineName = os.hostname();
  db.prepare(`
    INSERT INTO settings(key, value) VALUES ('machine_id', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(machineId);
  db.prepare(`
    INSERT INTO settings(key, value) VALUES ('machine_name', ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(machineName);

  return db;
}

function getSetting(key) {
  const db = openSettingsDb();
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row?.value;
  } finally {
    db.close();
  }
}

function setSetting(key, value) {
  const db = openSettingsDb();
  try {
    db.prepare(`
      INSERT INTO settings(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(key, value);
    return true;
  } finally {
    db.close();
  }
}

module.exports = {
  openSettingsDb,
  getSetting,
  setSetting
};
