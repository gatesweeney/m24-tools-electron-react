// indexer/worker/platform/bins.js
const fs = require('fs');
const path = require('path');

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function requireBinDir() {
  const dir = process.env.M24_BIN_DIR;
  if (!dir) throw new Error('M24_BIN_DIR is not set (required for bundled binaries).');
  if (!fs.existsSync(dir)) throw new Error(`M24_BIN_DIR does not exist: ${dir}`);
  return dir;
}

function binPath(name) {
  const dir = requireBinDir();
  const p = path.join(dir, name);
  if (!isFile(p)) throw new Error(`Missing bundled binary: ${p}`);
  return p;
}

module.exports = { requireBinDir, binPath };