// indexer/scanner.js
const fs = require('fs');
const path = require('path');
const { getMachineId } = require('./config');

const VIDEO_EXT = new Set(['.mov', '.mp4', '.mxf', '.r3d', '.braw', '.mkv']);
const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.mp3', '.flac']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic']);
const PROJECT_EXT = new Set(['.drp', '.prproj', '.aep', '.fcpxml', '.xml']);

function classifyFileType(ext) {
  const e = (ext || '').toLowerCase();
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (IMAGE_EXT.has(e)) return 'image';
  if (PROJECT_EXT.has(e)) return 'project';
  return 'other';
}

function shouldSkipPath(name) {
  const lower = name.toLowerCase();
  return (
    lower === '.spotlight-v100' ||
    lower === '.fseventsd' ||
    lower === '.trashes' ||
    lower === '.trash' ||
    lower === 'node_modules' ||
    lower.startsWith('.ds_store')
  );
}

async function scanRootQuick(db, driveUuid, rootPath) {
  const machineId = getMachineId();
  const scanStart = new Date().toISOString();

  const seen = new Set();
  let totalFiles = 0;
  let totalDirs = 0;
  let newEntries = 0;
  let changedEntries = 0;

  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (shouldSkipPath(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      const rel = path.relative(rootPath, fullPath) || '.';
      let stat;
      try {
        stat = await fs.promises.lstat(fullPath);
      } catch {
        continue;
      }

      const isDir = entry.isDirectory();
      const ext = isDir ? '' : path.extname(entry.name);
      const fileType = isDir ? 'dir' : classifyFileType(ext);

      seen.add(rel);

      const existing = db.prepare(`
        SELECT id, size_bytes, mtime, last_status
        FROM files
        WHERE machine_id = ? AND drive_uuid = ? AND root_path = ? AND relative_path = ?
      `).get(machineId, driveUuid, rootPath, rel);

      const nowIso = new Date().toISOString();
      const mtime = Math.floor(stat.mtimeMs / 1000);
      const ctime = Math.floor(stat.ctimeMs / 1000);
      const size = isDir ? null : stat.size;

      if (!existing) {
        db.prepare(`
          INSERT INTO files (
            machine_id, drive_uuid, root_path, relative_path,
            name, ext, is_dir, size_bytes, mtime, ctime,
            file_type, first_seen_at, last_seen_at, last_status,
            deleted_at, hash, hash_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          machineId,
          driveUuid,
          rootPath,
          rel,
          entry.name,
          ext,
          isDir ? 1 : 0,
          size,
          mtime,
          ctime,
          fileType,
          nowIso,
          nowIso,
          'present',
          null,
          null,
          null
        );
        newEntries++;
      } else {
        const changed =
          existing.size_bytes !== size ||
          existing.mtime !== mtime ||
          existing.last_status !== 'present';

        if (changed) {
          db.prepare(`
            UPDATE files
            SET size_bytes = ?, mtime = ?, ctime = ?, file_type = ?,
                last_seen_at = ?, last_status = 'present'
            WHERE id = ?
          `).run(
            size,
            mtime,
            ctime,
            fileType,
            nowIso,
            existing.id
          );
          changedEntries++;
        } else {
          db.prepare(`
            UPDATE files
            SET last_seen_at = ?, last_status = 'present'
            WHERE id = ?
          `).run(nowIso, existing.id);
        }
      }

      if (isDir) {
        totalDirs++;
        stack.push(fullPath);
      } else {
        totalFiles++;
      }
    }
  }

  // Mark missing files for this root/drive that weren't seen in this scan
  const missingNow = db.prepare(`
    SELECT id FROM files
    WHERE machine_id = ? AND drive_uuid = ? AND root_path = ?
      AND last_status = 'present' AND last_seen_at < ?
  `).all(machineId, driveUuid, rootPath, scanStart);

  const nowIso2 = new Date().toISOString();
  for (const row of missingNow) {
    db.prepare(`
      UPDATE files
      SET last_status = 'missing', deleted_at = COALESCE(deleted_at, ?)
      WHERE id = ?
    `).run(nowIso2, row.id);
  }

  const scanEnd = new Date().toISOString();
  db.prepare(`
    INSERT INTO scans (
      machine_id, drive_uuid, root_path,
      started_at, finished_at, status,
      total_files, total_dirs,
      new_entries, removed_entries, changed_entries
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    machineId,
    driveUuid,
    rootPath,
    scanStart,
    scanEnd,
    'ok',
    totalFiles,
    totalDirs,
    newEntries,
    missingNow.length,
    changedEntries
  );

  db.prepare(`
    UPDATE drives SET last_scan_at = ?
    WHERE machine_id = ? AND volume_uuid = ?
  `).run(scanEnd, machineId, driveUuid);
}

async function scanRootDeep(db, driveUuid, rootPath) {
  // For now, same as quick; later add hashing, extra metadata here.
  await scanRootQuick(db, driveUuid, rootPath);
}

module.exports = {
  scanRootQuick,
  scanRootDeep
};