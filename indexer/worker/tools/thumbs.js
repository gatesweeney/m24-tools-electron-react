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

function volumeThumbTargets(volumeUuid) {
  const baseThumbs = getThumbsDir();
  return [
    path.join(baseThumbs, `volume_${volumeUuid}_t1.jpg`),
    path.join(baseThumbs, `volume_${volumeUuid}_t2.jpg`),
    path.join(baseThumbs, `volume_${volumeUuid}_t3.jpg`)
  ];
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

async function ffprobeDuration(inputPath, { timeoutMs = 15000 } = {}) {
  const ffprobe = binPath('ffprobe');
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];
    const p = spawn(ffprobe, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      resolve(0);
    }, timeoutMs);
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', () => {
      clearTimeout(timer);
      const v = parseFloat(out.trim());
      resolve(Number.isFinite(v) ? v : 0);
    });
  });
}

/**
 * Try to create a jpg thumbnail from a video file using ffmpeg.
 * Returns true on success.
 */
async function ffmpegThumb(inputPath, outPath, { timeoutMs = 15000, seekSeconds = 3 } = {}) {
  // Allow override in env
    const ffmpeg = binPath('ffmpeg');

  return new Promise((resolve) => {
    // -ss 3: seek a little in
    // -frames:v 1: single frame
    // scale=320:-1: width 320
    const args = [
      '-y',
      '-ss', String(seekSeconds),
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
  const targets = volumeThumbTargets(volumeUuid);
  ensureDir(getThumbsDir());

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
  const targets = volumeThumbTargets(volumeUuid);
  ensureDir(getThumbsDir());

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

function fileThumbTarget(volumeUuid, rootPath, relativePath) {
  const baseThumbs = getThumbsDir();
  const isManual = volumeUuid && volumeUuid.startsWith('manual:');
  const keyBase = isManual ? `${rootPath || ''}|${relativePath || ''}` : `${volumeUuid || 'unknown'}|${relativePath || ''}`;
  const key = keyBase || `${volumeUuid || 'unknown'}|${relativePath || ''}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(baseThumbs, `file_${hash}.jpg`);
}

async function generateFileThumbMid(filePath, outPath) {
  const duration = await ffprobeDuration(filePath);
  if (!duration) return false;
  const t = Math.max(0, Math.floor(duration / 2));
  return ffmpegThumb(filePath, outPath, { timeoutMs: 20000, seekSeconds: t });
}

module.exports = {
  storeVolumeThumbsFromPaths,
  generateVolumeThumbsFfmpeg,
  fileThumbTarget,
  generateFileThumbMid
};
