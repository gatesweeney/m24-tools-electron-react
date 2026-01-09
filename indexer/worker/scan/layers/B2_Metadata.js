// indexer/worker/scan/layers/B2_Metadata.js
const path = require('path');
const { runFfprobe } = require('../../tools/ffprobe');

const MEDIA_FILE_TYPES = ['video', 'audio'];
const BATCH_SIZE = 50;
const YIELD_INTERVAL_MS = 10;

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * B2_Metadata: Run ffprobe on all media files that don't have metadata yet.
 * Stores results in media_metadata table.
 */
async function runB2Metadata({ db, volume, cancelToken, progress }) {
  const volumeUuid = volume.volume_uuid;
  const rootPath = volume.mount_point;

  progress?.({ stage: 'B2_metadata_start', volume_uuid: volumeUuid });

  // Get all media files that don't have metadata yet
  // LEFT JOIN to find files without corresponding media_metadata entry
  const filesToProbe = db.prepare(`
    SELECT f.id, f.relative_path, f.name, f.file_type
    FROM files f
    LEFT JOIN media_metadata m ON f.id = m.file_id
    WHERE f.volume_uuid = ?
      AND f.root_path = ?
      AND f.is_dir = 0
      AND f.status = 'present'
      AND f.file_type IN ('video', 'audio')
      AND m.id IS NULL
  `).all(volumeUuid, rootPath);

  const total = filesToProbe.length;
  let processed = 0;
  let probed = 0;
  let failed = 0;

  progress?.({
    stage: 'B2_metadata_count',
    volume_uuid: volumeUuid,
    total,
    message: `Found ${total} media files needing metadata extraction`
  });

  if (total === 0) {
    progress?.({ stage: 'B2_metadata_end', volume_uuid: volumeUuid, processed: 0, probed: 0, failed: 0 });
    return;
  }

  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT INTO media_metadata (
      file_id, duration_sec, width, height, video_codec, audio_codec,
      audio_sample_rate, audio_channels, bitrate, format_name, raw_json, probed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      duration_sec = excluded.duration_sec,
      width = excluded.width,
      height = excluded.height,
      video_codec = excluded.video_codec,
      audio_codec = excluded.audio_codec,
      audio_sample_rate = excluded.audio_sample_rate,
      audio_channels = excluded.audio_channels,
      bitrate = excluded.bitrate,
      format_name = excluded.format_name,
      raw_json = excluded.raw_json,
      probed_at = excluded.probed_at
  `);

  for (const file of filesToProbe) {
    if (cancelToken.cancelled) {
      progress?.({ stage: 'B2_metadata_cancelled', volume_uuid: volumeUuid, processed, probed, failed });
      return;
    }

    const filePath = path.join(rootPath, file.relative_path);

    try {
      const metadata = await runFfprobe(filePath);

      if (metadata) {
        insertStmt.run(
          file.id,
          metadata.duration_sec,
          metadata.width,
          metadata.height,
          metadata.video_codec,
          metadata.audio_codec,
          metadata.audio_sample_rate,
          metadata.audio_channels,
          metadata.bitrate,
          metadata.format_name,
          metadata.raw_json,
          nowIso()
        );
        probed++;
      } else {
        // File exists but ffprobe failed - could be unsupported format
        // Insert a placeholder so we don't retry every scan
        insertStmt.run(
          file.id,
          null, null, null, null, null, null, null, null, null, null,
          nowIso()
        );
        failed++;
      }
    } catch (e) {
      // Insert placeholder on error
      try {
        insertStmt.run(
          file.id,
          null, null, null, null, null, null, null, null, null, null,
          nowIso()
        );
      } catch {}
      failed++;
    }

    processed++;

    // Report progress every BATCH_SIZE files
    if (processed % BATCH_SIZE === 0) {
      progress?.({
        stage: 'B2_metadata_progress',
        volume_uuid: volumeUuid,
        processed,
        total,
        probed,
        failed,
        percent: Math.round((processed / total) * 100)
      });
      await delay(YIELD_INTERVAL_MS);
    }
  }

  progress?.({
    stage: 'B2_metadata_end',
    volume_uuid: volumeUuid,
    processed,
    probed,
    failed
  });
}

module.exports = { runB2Metadata };
