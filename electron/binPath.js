const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function makeExecutable(p) {
  try { fs.chmodSync(p, 0o755); } catch {}
}

function resolveBin(relativePathFromElectronFolder) {
  // electron folder: __dirname is ".../electron" in dev
  // in prod: __dirname is ".../app.asar/electron"
  const devPath = path.join(__dirname, relativePathFromElectronFolder);

  // in prod, binaries should be unpacked
  const prodPath = devPath.includes('app.asar')
    ? devPath.replace('app.asar', 'app.asar.unpacked')
    : devPath;

  const candidate = app.isPackaged ? prodPath : devPath;

  if (isFile(candidate)) {
    makeExecutable(candidate);
    return candidate;
  }

  return null;
}

module.exports = {
  resolveBin
};