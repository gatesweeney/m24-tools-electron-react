// electron/binResolver.js
const path = require('path');

function getBundledBinDir() {
  // __dirname in dev: <repo>/electron
  // __dirname in packaged: .../Resources/app.asar/electron
  const devDir = path.join(__dirname, 'bin');

  // In packaged apps, binaries are unpacked to app.asar.unpacked
  const prodDir = devDir.includes('app.asar')
    ? devDir.replace('app.asar', 'app.asar.unpacked')
    : devDir;

  return { devDir, prodDir };
}

module.exports = { getBundledBinDir };