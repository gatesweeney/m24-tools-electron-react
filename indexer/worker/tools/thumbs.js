// indexer/worker/tools/thumbs.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getThumbsDir } = require('../config/paths');
const { binPath } = require('../platform/bins');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function stablePickIndices(seedStr, count, max) {
  if (max <= 0) return [];
  const seed = crypto.createHash('sha1').update(seedStr).digest();
  let x = seed.readUInt32BE(0);
  const picked = new Set();
  while (picked.size < Math.min(count, max)) {
    x = (x * 1664525 + 1013904223) >>> 0;
    picked.add(x % max);
  }
  return Array.from(picked);
}

async function copyFileSafe(src, dst) {
  try {
    await fsp.copyFile(src, dst);
    return true;
  } catch {
    return false;
  }
}

function isLikelyUnsupportedThumbExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.r3d' || ext === '.braw';
}

/**
 * Try to create a jpg thumbnail from a video file using ffmpeg.
 * Returns true on success.
 */
async function ffmpegThumb(inputPath, outPath, { timeoutMs = 15000 } = {}) {
  // Allow override in env
    const ffmpeg = binPath('ffmpeg');

  return new Promise((resolve) => {
    // -ss 3: seek a little in
    // -frames:v 1: single frame
    // scale=320:-1: width 320
    const args = [
      '-y',
      '-ss', '3',
      '-i', inputPath,
      '-frames:v', '1',
      '-vf', 'scale=320:-1',
      '-q:v', '4',
      outPath
    ];

    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      resolve(false);
    }, timeoutMs);

    p.stderr.on('data', (d) => (stderr += d.toString()));

    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outPath)) return resolve(true);
      // swallow errors but leave a breadcrumb for logs upstream if desired
      return resolve(false);
    });
  });
}

/**
 * Store 3 thumbnails per volume in iCloud thumbs folder.
 * Returns { thumb1, thumb2, thumb3 } local stored paths.
 */
async function storeVolumeThumbsFromPaths(volumeUuid, sourceThumbPaths) {
  const baseThumbs = getThumbsDir();
  const volDir = path.join(baseThumbs, volumeUuid);
  ensureDir(volDir);

  const targets = [
    path.join(volDir, 't1.jpg'),
    path.join(volDir, 't2.jpg'),
    path.join(volDir, 't3.jpg')
  ];

  const out = { thumb1: null, thumb2: null, thumb3: null };

  for (let i = 0; i < 3; i++) {
    const src = sourceThumbPaths[i];
    const dst = targets[i];
    if (!src) continue;

    const ok = await copyFileSafe(src, dst);
    if (ok) {
      if (i === 0) out.thumb1 = dst;
      if (i === 1) out.thumb2 = dst;
      if (i === 2) out.thumb3 = dst;
    }
  }

  return out;
}

/**
 * Generate 3 thumbs via ffmpeg from representative video files.
 * videoFiles: array of absolute file paths
 */
async function generateVolumeThumbsFfmpeg(volumeUuid, videoFiles) {
  const baseThumbs = getThumbsDir();
  const volDir = path.join(baseThumbs, volumeUuid);
  ensureDir(volDir);

  const targets = [
    path.join(volDir, 't1.jpg'),
    path.join(volDir, 't2.jpg'),
    path.join(volDir, 't3.jpg')
  ];

  const out = { thumb1: null, thumb2: null, thumb3: null };

  const usable = videoFiles.filter((p) => !isLikelyUnsupportedThumbExt(p));

  const idxs = stablePickIndices(volumeUuid, 3, usable.length);
  for (let i = 0; i < idxs.length; i++) {
    const srcVideo = usable[idxs[i]];
    const dst = targets[i];

    const ok = await ffmpegThumb(srcVideo, dst);
    if (ok) {
      if (i === 0) out.thumb1 = dst;
      if (i === 1) out.thumb2 = dst;
      if (i === 2) out.thumb3 = dst;
    }
  }

  return out;
}

module.exports = {
  storeVolumeThumbsFromPaths,
  generateVolumeThumbsFfmpeg
};