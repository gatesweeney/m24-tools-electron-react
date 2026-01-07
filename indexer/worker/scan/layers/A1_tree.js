// indexer/worker/scan/layers/A1_tree.js
const path = require('path');
const { bfsWalk } = require('../util/bfsWalker');

function nowIso() {
  return new Date().toISOString();
}

function upsertDir(db, volumeUuid, rootPath, relPath) {
  const name = path.basename(relPath);
  const ext = '';
  const ts = nowIso();

  // is_dir = 1, status present
  // We only set basic fields in A1
  db.prepare(`
    INSERT INTO files (
      volume_uuid, root_path, relative_path,
      name, ext, is_dir, last_seen_at, status
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 'present')
    ON CONFLICT(volume_uuid, root_path, relative_path)
    DO UPDATE SET last_seen_at=excluded.last_seen_at, status='present'
  `).run(volumeUuid, rootPath, relPath, name, ext, ts);
}

async function runA1Tree({ db, volume, cancelToken, progress }) {
  const rootPath = volume.mount_point;
  const volumeUuid = volume.volume_uuid;

  progress?.({ stage: 'A1_tree_start', volume_uuid: volumeUuid, rootPath });

  // Depth-limited dir scan for quick fingerprinting
  const depthLimit = 3;

  let dirCount = 0;
  const topFolders = new Map(); // name -> count

  await bfsWalk(
    rootPath,
    { depthLimit, dirsOnly: true, yieldEvery: 500, yieldMs: 10 },
    async ({ relPath, name, isDir, depth }) => {
      if (cancelToken.cancelled) return;

      upsertDir(db, volumeUuid, rootPath, relPath);
      dirCount++;

      // capture top-level-ish names for signature hints
      if (depth <= 2 && isDir) {
        topFolders.set(name, (topFolders.get(name) || 0) + 1);
      }

      if (dirCount % 250 === 0) {
        progress?.({
          stage: 'A1_tree_progress',
          volume_uuid: volumeUuid,
          dirs: dirCount
        });
      }
    },
    cancelToken
  );

  // Store signature hint JSON (only quick fields for now)
  const hint = {
    depthLimit,
    topFolders: Array.from(topFolders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([n]) => n)
  };

  db.prepare(`
    UPDATE volumes
    SET signature_hint = ?
    WHERE volume_uuid = ?
  `).run(JSON.stringify(hint), volumeUuid);

  progress?.({ stage: 'A1_tree_end', volume_uuid: volumeUuid, dirs: dirCount });
}

module.exports = { runA1Tree };