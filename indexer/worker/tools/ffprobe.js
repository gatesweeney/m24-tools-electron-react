// indexer/worker/tools/ffprobe.js
const fs = require('fs');
const { spawn } = require('child_process');
const { binPath } = require('../platform/bins');

/**
 * Run ffprobe on a file and return parsed metadata.
 * Returns null on error (file missing, unsupported format, etc.)
 */
async function runFfprobe(filePath, { timeoutMs = 30000 } = {}) {
  const ffprobe = binPath('ffprobe');

  return new Promise((resolve) => {
    if (!filePath) {
      resolve(null);
      return;
    }

    if (!fs.existsSync(filePath)) {
      resolve(null);
      return;
    }

    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    const p = spawn(ffprobe, args, { timeout: timeoutMs });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      resolve(null);
    }, timeoutMs);

    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });

    p.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    p.on('close', (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        resolve(null);
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
        const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');

        resolve({
          duration_sec: data.format?.duration ? parseFloat(data.format.duration) : null,
          bitrate: data.format?.bit_rate ? parseInt(data.format.bit_rate, 10) : null,
          format_name: data.format?.format_name || null,
          video_codec: videoStream?.codec_name || null,
          width: videoStream?.width || null,
          height: videoStream?.height || null,
          audio_codec: audioStream?.codec_name || null,
          audio_sample_rate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : null,
          audio_channels: audioStream?.channels || null,
          raw_json: JSON.stringify(data)
        });
      } catch {
        resolve(null);
      }
    });
  });
}

module.exports = { runFfprobe };
