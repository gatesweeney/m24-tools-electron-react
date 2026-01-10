// indexer/worker/scan/scanManager.js
const { runA1Tree } = require('./layers/A1_tree');
const { runA2Files } = require('./layers/A2_Files');
const { runA3Stats } = require('./layers/A3_stats');
const { runA4Logs } = require('./layers/A4_logs');
const { runA5Thumbs } = require('./layers/A5_thumbs');
const { runA6FileThumbs } = require('./layers/A6_fileThumbs');
const { runB2Metadata } = require('./layers/B2_Metadata');

// Detailed scan stubs (we implement next)
async function runB1Refresh({ progress, volume_uuid }) {
  progress?.({ stage: 'B1_refresh_start', volume_uuid });
  progress?.({ stage: 'B1_refresh_end', volume_uuid });
}
async function runB3Hash({ progress, volume_uuid }) {
  progress?.({ stage: 'B3_hash_start', volume_uuid });
  progress?.({ stage: 'B3_hash_end', volume_uuid });
}

async function runVolumeScan({ db, volume, cancelToken, progress }) {
  const volume_uuid = volume.volume_uuid;

  // FAST
  await runA1Tree({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA2Files({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA3Stats({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA4Logs({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA5Thumbs({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA6FileThumbs({ db, volume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  // DETAILED
  await runB1Refresh({ db, volume, cancelToken, progress, volume_uuid });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runB2Metadata({ db, volume, cancelToken, progress, volume_uuid });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runB3Hash({ db, volume, cancelToken, progress, volume_uuid });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  return { ok: true };
}

async function runManualRootScan({ db, root, cancelToken, progress }) {
  // We scan the manual root path like a "volume", but store volume_uuid as `manual:<id>`
  const fakeVolume = {
    volume_uuid: `manual:${root.id}`,
    volume_name: root.label || root.path,
    mount_point: root.path
  };

  // FAST layers
  await runA1Tree({ db, volume: fakeVolume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA2Files({ db, volume: fakeVolume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA3Stats({ db, volume: fakeVolume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  await runA6FileThumbs({ db, volume: fakeVolume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  // DETAILED - run ffprobe on media files
  await runB2Metadata({ db, volume: fakeVolume, cancelToken, progress });
  if (cancelToken.cancelled) return { ok: false, cancelled: true };

  // Update last_scan_at on manual root
  db.prepare(`UPDATE manual_roots SET last_scan_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), root.id);

  return { ok: true };
}

module.exports = { runVolumeScan, runManualRootScan };
