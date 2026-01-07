// indexer/worker/scan/layers/A5_thumbs.js
const path = require('path');
const { storeVolumeThumbsFromPaths, generateVolumeThumbsFfmpeg } = require('../../tools/thumbs');

function nowIso() {
  return new Date().toISOString();
}

async function runA5Thumbs({ db, volume, cancelToken, progress }) {
  const volumeUuid = volume.volume_uuid;
  const rootPath = volume.mount_point;

  // Only run thumbs on first-seen (per your requirement):
  // if thumbs already stored for this volume, skip.
  const v = db.prepare(`
    SELECT thumb1_path, thumb2_path, thumb3_path
    FROM volumes
    WHERE volume_uuid = ?
  `).get(volumeUuid);

  if (v && (v.thumb1_path || v.thumb2_path || v.thumb3_path)) {
    progress?.({ stage: 'A5_thumbs_skip', volume_uuid: volumeUuid, reason: 'already_generated' });
    return;
  }

  progress?.({ stage: 'A5_thumbs_start', volume_uuid: volumeUuid });

  // 1) Prefer Foolcat thumbs if available for this volume
  const rep = db.prepare(`
    SELECT thumb1_path, thumb2_path, thumb3_path
    FROM foolcat_reports
    WHERE volume_uuid = ?
    ORDER BY last_parsed_at DESC
    LIMIT 1
  `).get(volumeUuid);

  let stored = { thumb1: null, thumb2: null, thumb3: null };

  if (rep && (rep.thumb1_path || rep.thumb2_path || rep.thumb3_path)) {
    if (cancelToken.cancelled) return;

    const srcThumbs = [rep.thumb1_path, rep.thumb2_path, rep.thumb3_path].filter(Boolean);
    progress?.({ stage: 'A5_thumbs_source', volume_uuid: volumeUuid, source: 'foolcat', count: srcThumbs.length });

    stored = await storeVolumeThumbsFromPaths(volumeUuid, [
      rep.thumb1_path,
      rep.thumb2_path,
      rep.thumb3_path
    ]);
  } else {
    // 2) Fallback: generate via ffmpeg from representative video files
    if (cancelToken.cancelled) return;

    // Pick a set of candidate video files from DB (already discovered in A2).
    // We’ll take up to 200 candidates to avoid huge memory/IO.
    const candidates = db.prepare(`
      SELECT relative_path, name
      FROM files
      WHERE volume_uuid = ?
        AND root_path = ?
        AND is_dir = 0
        AND file_type = 'video'
      LIMIT 200
    `).all(volumeUuid, rootPath);

    const videoFiles = candidates.map((r) => path.join(rootPath, r.relative_path));

    progress?.({ stage: 'A5_thumbs_source', volume_uuid: volumeUuid, source: 'ffmpeg', candidates: videoFiles.length });

    stored = await generateVolumeThumbsFfmpeg(volumeUuid, videoFiles);
  }

  // Save stored thumb paths into volumes row
  db.prepare(`
    UPDATE volumes
    SET thumb1_path = ?,
        thumb2_path = ?,
        thumb3_path = ?
    WHERE volume_uuid = ?
  `).run(stored.thumb1, stored.thumb2, stored.thumb3, volumeUuid);

  progress?.({
    stage: 'A5_thumbs_end',
    volume_uuid: volumeUuid,
    thumb1: stored.thumb1,
    thumb2: stored.thumb2,
    thumb3: stored.thumb3
  });
}

module.exports = { runA5Thumbs };