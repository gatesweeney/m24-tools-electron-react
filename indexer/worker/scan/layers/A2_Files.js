// indexer/worker/scan/layers/A2_files.js
const path = require('path');
const { bfsWalk } = require('../util/bfsWalker');

function nowIso() {
  return new Date().toISOString();
}

function classifyFileType(ext) {
  const e = (ext || '').toLowerCase();
  if (['.mov', '.mp4', '.mxf', '.mts', '.m2ts', '.avi', '.mkv', '.webm'].includes(e)) return 'video';
  if (['.wav', '.aif', '.aiff', '.mp3', '.m4a', '.flac'].includes(e)) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic', '.bmp'].includes(e)) return 'image';
  if (['.drp', '.prproj', '.aep', '.fcpxml', '.xml'].includes(e)) return 'project';
  return 'other';
}

function upsertFileOrDir(db, volumeUuid, rootPath, relPath, name, isDir) {
  const ts = nowIso();
  const ext = isDir ? '' : path.extname(name);
  const fileType = isDir ? 'dir' : classifyFileType(ext);

  db.prepare(`
    INSERT INTO files (
      volume_uuid, root_path, relative_path,
      name, ext, is_dir,
      file_type, last_seen_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'present')
    ON CONFLICT(volume_uuid, root_path, relative_path)
    DO UPDATE SET
      name=excluded.name,
      ext=excluded.ext,
      is_dir=excluded.is_dir,
      file_type=excluded.file_type,
      last_seen_at=excluded.last_seen_at,
      status='present'
  `).run(
    volumeUuid,
    rootPath,
    relPath,
    name,
    ext,
    isDir ? 1 : 0,
    fileType,
    ts
  );
}

async function runA2Files({ db, volume, cancelToken, progress }) {
  const rootPath = volume.mount_point;
  const volumeUuid = volume.volume_uuid;

  progress?.({ stage: 'A2_files_start', volume_uuid: volumeUuid, rootPath });

  let fileCount = 0;
  let dirCount = 0;

  await bfsWalk(
    rootPath,
    { depthLimit: null, dirsOnly: false, yieldEvery: 500, yieldMs: 10 },
    async ({ relPath, name, isDir }) => {
      if (cancelToken.cancelled) return;

      upsertFileOrDir(db, volumeUuid, rootPath, relPath, name, isDir);

      if (isDir) dirCount++;
      else fileCount++;

      if ((fileCount + dirCount) % 1000 === 0) {
        progress?.({
          stage: 'A2_files_progress',
          volume_uuid: volumeUuid,
          dirs: dirCount,
          files: fileCount
        });
      }
    },
    cancelToken
  );

  progress?.({
    stage: 'A2_files_end',
    volume_uuid: volumeUuid,
    dirs: dirCount,
    files: fileCount
  });
}

module.exports = { runA2Files };