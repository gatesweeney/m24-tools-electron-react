// indexer/worker/scan/scanManager.js
const { scanVolumeRemote, scanManualRootRemote } = require('./scanRemote');

async function runVolumeScan({ volume, cancelToken, progress, generateThumbs = false }) {
  const result = await scanVolumeRemote({ volume, cancelToken, progress, generateThumbs });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };
  return { ok: true, result };
}

async function runManualRootScan({ root, cancelToken, progress, generateThumbs = false }) {
  const result = await scanManualRootRemote({ root, cancelToken, progress, generateThumbs });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };
  return { ok: true, result };
}

module.exports = { runVolumeScan, runManualRootScan };
