// indexer/worker/config/paths.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function getBaseDir() {
  // iCloud Documents for most setups when Desktop & Documents is enabled.
  // User can override with M24_INDEX_DIR if needed.
  const override = process.env.M24_INDEX_DIR && process.env.M24_INDEX_DIR.trim();
  if (override) return override;

  return path.join(os.homedir(), 'Documents', 'M24Index');
}

function getMachineId(baseDir) {
  const idFile = path.join(baseDir, 'machine-id.txt');

  try {
    if (fs.existsSync(idFile)) {
      const id = fs.readFileSync(idFile, 'utf8').trim();
      if (id) return id;
    }
  } catch {}

  const id = crypto.randomUUID();
  ensureDir(baseDir);
  fs.writeFileSync(idFile, id + '\n', 'utf8');
  return id;
}

function getMachineDir() {
  const base = getBaseDir();
  ensureDir(base);

  const machineId = getMachineId(base);
  const machineDir = path.join(base, machineId);
  ensureDir(machineDir);

  return { baseDir: base, machineId, machineDir };
}

function getDbPath() {
  const { machineDir } = getMachineDir();
  return path.join(machineDir, 'index.db');
}

function getThumbsDir() {
  const { machineDir } = getMachineDir();
  const thumbsDir = path.join(machineDir, 'thumbs');
  ensureDir(thumbsDir);
  return thumbsDir;
}

module.exports = {
  getBaseDir,
  getMachineDir,
  getDbPath,
  getThumbsDir
};