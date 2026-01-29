// indexer/config.js
const os = require('os');
const path = require('path');
const fs = require('fs');

function getMachineId() {
  // For now use hostname; later we can replace with a more stable UUID
  return os.hostname();
}

function getIcloudIndexDir() {
  // Default iCloud Drive path for most setups.
  // You can override via env var M24_INDEX_DIR if needed.
  const fallback = path.join(
    os.homedir(),
    'Documents',
    'M24Index'
  );

  const envDir = process.env.M24_INDEX_DIR;
  const dir = envDir || fallback;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

function getDbPath() {
  const machineId = getMachineId();
  const dir = getIcloudIndexDir();
  return path.join(dir, `index-${machineId}.db`);
}

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes for recurring scans

module.exports = {
  getMachineId,
  getIcloudIndexDir,
  getDbPath,
  SCAN_INTERVAL_MS
};