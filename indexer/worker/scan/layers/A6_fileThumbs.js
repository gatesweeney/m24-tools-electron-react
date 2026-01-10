// indexer/worker/scan/layers/A6_fileThumbs.js
const fs = require('fs');
const path = require('path');
const { fileThumbTarget, generateFileThumbMid } = require('../../tools/thumbs');

async function runA6FileThumbs({ db, volume, cancelToken, progress }) {
  const volumeUuid = volume.volume_uuid;
  const rootPath = volume.mount_point;

  progress?.({ stage: 'A6_file_thumbs_start', volume_uuid: volumeUuid });

  const rows = db.prepare(`
    SELECT id, volume_uuid, root_path, relative_path, name, thumb_path, file_type
    FROM files
    WHERE volume_uuid = ?
      AND is_dir = 0
      AND file_type = 'video'
      AND (thumb_path IS NULL OR thumb_path = '')
    LIMIT 200
  `).all(volumeUuid);

  let generated = 0;
  let skipped = 0;

  for (const r of rows) {
    if (cancelToken.cancelled) break;
    const absPath = path.join(r.root_path, r.relative_path);
    if (!fs.existsSync(absPath)) {
      skipped++;
      continue;
    }

    const target = fileThumbTarget(r.volume_uuid, r.root_path, r.relative_path);
    if (fs.existsSync(target)) {
      db.prepare(`UPDATE files SET thumb_path = ? WHERE id = ?`).run(target, r.id);
      skipped++;
      continue;
    }

    const ok = await generateFileThumbMid(absPath, target);
    if (ok) {
      db.prepare(`UPDATE files SET thumb_path = ? WHERE id = ?`).run(target, r.id);
      generated++;
    } else {
      skipped++;
    }
  }

  progress?.({
    stage: 'A6_file_thumbs_end',
    volume_uuid: volumeUuid,
    generated,
    skipped
  });
}

module.exports = { runA6FileThumbs };
