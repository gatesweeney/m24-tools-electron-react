// indexer/camera.js
const { spawnSync } = require('child_process');
const path = require('path');

function parseCameraNameFromFfprobe(json) {
  if (!json) return null;

  // Try format tags
  const fmtTags = json.format?.tags || {};
  const streams = json.streams || [];

  const candidates = [];

  if (fmtTags.com_sony_camera_model_name) {
    candidates.push(fmtTags.com_sony_camera_model_name);
  }
  if (fmtTags.camera_model_name) {
    candidates.push(fmtTags.camera_model_name);
  }
  if (fmtTags.model) {
    candidates.push(fmtTags.model);
  }
  if (fmtTags.make && fmtTags.model) {
    candidates.push(`${fmtTags.make} ${fmtTags.model}`);
  }

  // Try video streams
  for (const s of streams) {
    const tags = s.tags || {};
    if (tags.com_sony_camera_model_name) {
      candidates.push(tags.com_sony_camera_model_name);
    }
    if (tags.camera_model_name) {
      candidates.push(tags.camera_model_name);
    }
    if (tags.model) {
      candidates.push(tags.model);
    }
  }

  // Clean candidates
  const cleaned = candidates
    .map((c) => (c || '').trim())
    .filter(Boolean);

  if (cleaned.length === 0) return null;

  // For now, just use the first distinct candidate
  return cleaned[0];
}

/**
 * Try to infer camera info for a given root by sampling a few video files.
 * db: open better-sqlite3 Database
 * driveUuid, rootPath: as stored in files
 */
function inferCameraForRoot(db, driveUuid, rootPath) {
  console.log('[camera] Inferring camera for', driveUuid, rootPath);

  // Pick up to 3 video files in this root
  const sampleFiles = db.prepare(`
    SELECT
      root_path,
      relative_path
    FROM files
    WHERE drive_uuid = ?
      AND root_path = ?
      AND is_dir = 0
      AND file_type = 'video'
    LIMIT 3
  `).all(driveUuid, rootPath);

  if (sampleFiles.length === 0) {
    console.log('[camera] No video files found for root; skipping:', rootPath);
    return;
  }

  let bestName = null;

  for (const row of sampleFiles) {
    const fullPath = path.join(row.root_path, row.relative_path);
    console.log('[camera] ffprobe sample:', fullPath);

    const ff = spawnSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      fullPath
    ], { encoding: 'utf8' });

    if (ff.status !== 0) {
      console.warn('[camera] ffprobe failed for', fullPath, 'status=', ff.status);
      continue;
    }

    let info = null;
    try {
      info = JSON.parse(ff.stdout);
    } catch (err) {
      console.warn('[camera] Failed to parse ffprobe JSON for', fullPath, err);
      continue;
    }

    const name = parseCameraNameFromFfprobe(info);
    if (name) {
      bestName = name;
      break;
    }
  }

  if (!bestName) {
    console.log('[camera] Could not infer camera name for', rootPath);
    return;
  }

  console.log('[camera] Inferred camera for root', rootPath, '→', bestName);

  // Upsert into root_camera_info
  const existing = db.prepare(`
    SELECT id FROM root_camera_info
    WHERE drive_uuid = ? AND root_path = ?
  `).get(driveUuid, rootPath);

  const details = null; // you can later store raw JSON here if you want
  const confidence = 0.8; // placeholder confidence score

  if (!existing) {
    db.prepare(`
      INSERT INTO root_camera_info (drive_uuid, root_path, camera_name, confidence, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(driveUuid, rootPath, bestName, confidence, details);
  } else {
    db.prepare(`
      UPDATE root_camera_info
      SET camera_name = ?, confidence = ?, details = ?
      WHERE id = ?
    `).run(bestName, confidence, details, existing.id);
  }
}

module.exports = {
  inferCameraForRoot
};