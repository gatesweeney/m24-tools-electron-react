const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

console.log('[yt-dlp] module loaded');

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function getYtDlpPath() {
  const base = path.join(__dirname, 'bin');
  const plat = process.platform;
  const arch = process.arch;

  let candidate = null;

  if (plat === 'darwin') {
    candidate = arch === 'arm64'
      ? path.join(base, 'yt-dlp-macos-arm64')
      : path.join(base, 'yt-dlp-macos-x64');
  } else if (plat === 'win32') {
    candidate = path.join(base, 'yt-dlp-win-x64.exe');
  } else {
    candidate = path.join(base, 'yt-dlp-linux-x64');
  }

  // In packaged apps, __dirname contains ".../app.asar/electron"
  // Binaries must run from ".../app.asar.unpacked/..."
  const unpackedCandidate = candidate.includes('app.asar')
    ? candidate.replace('app.asar', 'app.asar.unpacked')
    : null;

  console.log('[yt-dlp] candidate:', candidate);
  console.log('[yt-dlp] unpackedCandidate:', unpackedCandidate);

  if (unpackedCandidate && isFile(unpackedCandidate)) {
    try { fs.chmodSync(unpackedCandidate, 0o755); } catch {}
    console.log('[yt-dlp] using unpacked bundled binary:', unpackedCandidate);
    return unpackedCandidate;
  }

  if (candidate && isFile(candidate)) {
    try { fs.chmodSync(candidate, 0o755); } catch {}
    console.log('[yt-dlp] using bundled binary:', candidate);
    return candidate;
  }

  // Try common Homebrew paths (macOS)
  const brewCandidates = [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp'
  ];
  for (const p of brewCandidates) {
    if (isFile(p)) {
      console.log('[yt-dlp] using system yt-dlp:', p);
      return p;
    }
  }

  console.log('[yt-dlp] using PATH yt-dlp');
  return 'yt-dlp';
}

module.exports = { getYtDlpPath };

function parseProgressLine(line) {
  // We will emit progress using a custom progress template:
  // PROGRESS|<percent>|<total_bytes>|<downloaded_bytes>|<speed>|<eta>|<filename>
  if (!line.startsWith('PROGRESS|')) return null;
  const parts = line.trim().split('|');
  if (parts.length < 8) return null;

  const percent = parseFloat(parts[1]);
  const totalBytes = parseInt(parts[2], 10);
  const downloadedBytes = parseInt(parts[3], 10);
  const speed = parts[4];
  const eta = parts[5];
  const filename = parts.slice(7).join('|'); // safe if filename contains |

  return {
    percent: Number.isFinite(percent) ? percent : null,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : null,
    speed,
    eta,
    filename
  };
}

async function getInfoJson(url) {
    console.log('[yt-dlp] getInfoJson called with URL:', url);
  return new Promise((resolve, reject) => {
    const yt = getYtDlpPath();
    const args = [
      '--no-warnings',
      '-J',
      url
    ];

    console.log('[yt-dlp] spawning:', yt, args.join(' '));
    console.log('[yt-dlp] spawn cmd:', yt);
    console.log('[yt-dlp] spawn args:', args);
    const p = spawn(yt, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';

    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));

    p.on('close', (code) => {
    console.log('[yt-dlp] exited with code:', code);
    console.log('[yt-dlp] stderr:', err);
    console.log('[yt-dlp] stdout length:', out.length);

      if (code !== 0) {
        return reject(new Error(err || `yt-dlp exited with code ${code}`));
      }
      try {
        console.log('[yt-dlp] stdout preview:', out.slice(0, 500));
        const json = JSON.parse(out);
        resolve(json);
      } catch (e) {
        reject(new Error(`Failed to parse yt-dlp JSON: ${e.message}`));
      }
    });
  });
}

function downloadWithFormat({ url, formatId, destDir, outputTemplate, onProgress }) {
  return new Promise((resolve, reject) => {
    const yt = getYtDlpPath();

    // Output template default: title.ext
    const outTpl = outputTemplate || '%(title)s.%(ext)s';

    // Custom progress line format
    const progressTpl = 'PROGRESS|%(progress._percent_str)s|%(progress.total_bytes_estimate)s|%(progress.downloaded_bytes)s|%(progress._speed_str)s|%(progress._eta_str)s|%(info.id)s|%(progress.filename)s';

    const args = [
      '--no-warnings',
      '--newline',
      '--progress',
      '--progress-template', progressTpl,
      '-f', formatId,
      '-o', path.join(destDir, outTpl),
      url
    ];

    const p = spawn(yt, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';

    p.stdout.on('data', (d) => {
      const chunk = d.toString();
      // yt-dlp emits multiple lines
      chunk.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        const prog = parseProgressLine(line);
        if (prog && typeof onProgress === 'function') {
          // percent might be " 12.3%" string; strip non-numeric
          const pct = parseFloat(String(prog.percent).replace('%', ''));
          onProgress({ ...prog, percent: Number.isFinite(pct) ? pct : null, raw: line });
        }
      });
    });

    p.stderr.on('data', (d) => (stderr += d.toString()));

    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `yt-dlp exited with code ${code}`));
      resolve({ ok: true });
    });
  });
}

function normalizeFormats(infoJson) {
  const formats = Array.isArray(infoJson.formats) ? infoJson.formats : [];

  console.log('[yt-dlp] total formats from yt-dlp:', formats.length);


  var ff = formats.map((f) => ({
    format_id: f.format_id,
    ext: f.ext,
    resolution: f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : ''),
    width: f.width || null,
    height: f.height || null,
    fps: f.fps || null,
    vcodec: f.vcodec || '',
    acodec: f.acodec || '',
    abr: f.abr || null,
    tbr: f.tbr || null,
    filesize: f.filesize || f.filesize_approx || null,
    format_note: f.format_note || '',
    protocol: f.protocol || '',
    audio_channels: f.audio_channels || null
  }));

  console.log(ff, '\nnormalized formats generated');
  // Basic fields we care about
  return ff
}

module.exports = {
  getInfoJson,
  normalizeFormats,
  downloadWithFormat
};