// indexer/worker/config/paths.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { getStableMachineId } = require('../../../electron/machineId');

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

function getMachineDir() {
  const base = getBaseDir();
  ensureDir(base);

  const machineId = getStableMachineId();
  const machineDir = path.join(base, machineId);
  ensureDir(machineDir);

  return { baseDir: base, machineId, machineDir };
}

function getDbPath() {
  const { machineDir } = getMachineDir();
  return path.join(machineDir, 'index.db');
}

function getSettingsDbPath() {
  const { machineDir } = getMachineDir();
  return path.join(machineDir, 'settings.db');
}

function getThumbsDir() {
  const base = getBaseDir();
  ensureDir(base);
  const thumbsDir = path.join(base, 'thumbs');
  ensureDir(thumbsDir);
  return thumbsDir;
}

function getLutsDir() {
  const base = getBaseDir();
  ensureDir(base);
  const lutsDir = path.join(base, 'luts');
  ensureDir(lutsDir);
  return lutsDir;
}

module.exports = {
  getBaseDir,
  getMachineDir,
  getDbPath,
  getSettingsDbPath,
  getThumbsDir,
  getLutsDir
};
