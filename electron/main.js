console.log('Electron: starting');

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const shell = require('electron').shell;
const { spawn } = require('child_process');
const os = require('os');
const { runProxyJob } = require('./fs-ops');
const { getInfoJson, normalizeFormats, downloadWithFormat } = require('./ytdlp');
const { resolveBin } = require('./binPath');
const { startIndexerWorker } = require('./workerLauncher');
const crypto = require('crypto');
const indexerQueries = require('../indexer/worker/db/queries');
const { searchIndexer } = require('../indexer/worker/db/search');
const worker = require('../indexer/worker/main');
const { sendWorkerMessage, getLatestIndexerStatus, onWorkerMessage } = require('./workerLauncher');

const ytDlpPath = resolveBin('bin/yt-dlp-macos-arm64');
const ffmpegPath = resolveBin('bin/ffmpeg-macos-arm64');
const ffprobePath = resolveBin('bin/ffprobe-macos-arm64');

if (!ytDlpPath) throw new Error('yt-dlp binary missing');
if (!ffmpegPath) throw new Error('ffmpeg binary missing');
if (!ffprobePath) throw new Error('ffprobe binary missing');

const ffmpegDir = path.dirname(ffmpegPath);

const isDev = !app.isPackaged;
let mainWindow;

let tray = null;
let isQuitting = false;

// simple rate limit for notifications
let lastNotifyAt = 0;
const lastScanStartByKey = new Map(); // key -> timestamp
function notify(title, body, opts = {}) {
  const { force = false } = opts;
  const now = Date.now();
  if (!force && now - lastNotifyAt < 1500) return;
  if (!force) lastNotifyAt = now;

  console.log('[notify]', { title, body, force, supported: Notification.isSupported() });

  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    } else {
      console.log('[notify] Notification not supported on this system');
    }
  } catch (e) {
    console.log('[notify] failed', e?.message || e);
  }
}

const activeScans = new Map(); // key -> { startedAt, name }

function scanKey(payload) {
  return payload.rootId
    ? `root:${payload.rootId}`
    : payload.volume_uuid
      ? `vol:${payload.volume_uuid}`
      : null;
}

onWorkerMessage((msg) => {
  if (!msg || msg.cmd !== 'indexerProgress') return;

  const p = msg.payload || {};
  const key = scanKey(p);
  if (!key) return;

  // Only show notifications for manual and mount scans, not scheduled interval scans
  const label = msg.label || '';
  const shouldNotify = label === 'MOUNT' || label === 'MANUAL' || label === 'MANUAL_ALL';

  const name =
    p.name ||
    p.rootPath ||
    p.volume_name ||
    p.volume_uuid ||
    'Unknown';

  // START
  if (p.stage === 'SCAN_START' || p.stage === 'A1_tree_start') {
    if (activeScans.has(key)) return; // already notified

    activeScans.set(key, { startedAt: Date.now(), name });

    if (shouldNotify) {
      notify(
        'Indexing Started',
        `Scanning ${name}`
      );
    }
  }

  // DONE
  if (p.stage === 'SCAN_DONE' || p.stage === 'A3_stats_end') {
    const entry = activeScans.get(key);
    activeScans.delete(key);

    if (shouldNotify) {
      const now = Date.now();
      const duration = entry ? Math.round((now - entry.startedAt) / 1000) : null;
      const body = duration ? `Finished ${name} in ${duration}s` : `Finished ${name}`;

      // If scan finishes almost immediately after start, delay the DONE toast slightly so macOS
      // doesn't effectively drop it due to back-to-back notifications.
      const minGapMs = 1200;
      const sinceStart = entry ? (now - entry.startedAt) : minGapMs;
      const delayMs = sinceStart < minGapMs ? (minGapMs - sinceStart) : 0;

      if (delayMs > 0) {
        setTimeout(() => notify('Indexing Complete', body, { force: true }), delayMs);
      } else {
        notify('Indexing complete', body, { force: true });
      }
    }
  }

  // CANCELLED
  if (p.stage === 'CANCELLED') {
    activeScans.delete(key);
    if (shouldNotify) {
      notify('Indexing Cancelled', name);
    }
  }

  // Forward to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('indexer:progress', msg);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
  width: 1600,
  height: 900,
  backgroundColor: '#121212',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: false,            // 👈 allow local file:// loads
    allowRunningInsecureContent: true
  },
  titleBarStyle: 'hiddenInset',
  title: 'M24 Tools'
});

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    // In dev, load the React dev server
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // In prod, load the built React app
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
  }

  // 👇 Open DevTools so we can see console/network in Electron
  //mainWindow.webContents.openDevTools();

  // 👇 Log load success/failure – this will print to the terminal
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Electron: did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Electron: did-fail-load', { errorCode, errorDescription, validatedURL });
  });
}

function ensureTray() {
  if (tray) return tray;

  // Try to load a PNG icon for the menu bar
  const devIcon = path.join(__dirname, '..', 'src', 'assets', 'webclip.png');
  const prodIcon = path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'assets', 'webclip.png');
  let iconPath = fs.existsSync(devIcon) ? devIcon : (fs.existsSync(prodIcon) ? prodIcon : null);

  let img = null;
  try {
    if (iconPath) {
      img = nativeImage.createFromPath(iconPath);
      if (img && !img.isEmpty()) {
        // menu bar icons should be small and template-ish
        img = img.resize({ width: 18, height: 18 });
      }
    }
  } catch {}

  tray = new Tray(img || nativeImage.createEmpty());
  tray.setToolTip('M24 Tools');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show M24 Tools',
      click: () => {
        if (!mainWindow) createWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Test Notification',
      click: () => {
        console.log('[tray] test notification clicked');
        notify('M24 Tools', 'Test notification', { force: true });
      }
    },
    {
      label: 'Open Notification Settings',
      click: () => {
        try { shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications'); } catch {}
      }
    },
    {
      label: 'Scan All Now',
      click: () => {
        try { sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'scanAll' } }); } catch {}
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (!mainWindow) createWindow();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

app.whenReady().then(() => {
  app.setName('M24 Tools');

  createWindow();

  ensureTray();

  startIndexerWorker();

  if (mainWindow) {
    mainWindow.setTitle('M24 Tools');
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => { isQuitting = true; });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: open directory dialog
ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// IPC: start proxy job
ipcMain.handle('proxy:start', async (event, config) => {
  try {
    const webContents = event.sender;
    const summary = await runProxyJob(config, (progress) => {
      webContents.send('proxy:progress', progress);
    });
    return { ok: true, summary };
  } catch (err) {
    console.error('Error running proxy job:', err);
    return { ok: false, error: err.message || String(err) };
  }
});


// Open file or reveal path in Finder
ipcMain.handle('fs:showItem', async (event, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'No file path provided.' };
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    console.error('Error showing item in folder:', err);
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('ytdlp:getFormats', async (_evt, url) => {
  try {
    const info = await getInfoJson(url);
    const formats = normalizeFormats(info);
    return {
      ok: true,
      info: {
        id: info.id,
        title: info.title,
        uploader: info.uploader,
        duration: info.duration,
        webpage_url: info.webpage_url
      },
      formats
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('ytdlp:download', async (evt, payload) => {
  try {
    const wc = evt.sender;
    const { url, formatId, destDir, outputTemplate } = payload;

    await downloadWithFormat({
      url,
      formatId,
      destDir,
      outputTemplate,
      onProgress: (p) => {
        wc.send('ytdlp:progress', p);
      }
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('yt:chooseFolder', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths?.[0]) return { ok: true, folder: null };
  return { ok: true, folder: res.filePaths[0] };
});

ipcMain.handle('yt:run', async (evt, payload) => {
  try {
    const wc = evt.sender;
    const { url, mode, folder } = payload;

    if (!url || !mode) return { ok: false, error: 'Missing url or mode.' };

    const destDir = folder && folder.trim()
      ? expandHome(folder.trim())
      : path.join(os.homedir(), 'Downloads');

    // Basic validation
    if (!destDir) return { ok: false, error: 'Invalid destination folder.' };

    const format = mode === 'video' ? "bv*[vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[ext=mp4]/bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/b --merge-output-format mp4 --recode-video=mp4" : 'ba';
    const args = ['--ffmpeg-location', ffmpegDir, '-f', format, url];

    // Important: make sure PATH includes common brew dirs for packaged app
    const env = {
      ...process.env,
      PATH: [
        process.env.PATH || '',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin'
      ].filter(Boolean).join(':')
    };

    wc.send('yt:log', `[yt] Running: yt-dlp ${args.join(' ')}`);
    wc.send('yt:log', `[yt] Saving to: ${destDir}`);

    const ytDlpPath = getBundledYtDlpPath();
    if (!ytDlpPath) {
      return { ok: false, error: 'Bundled yt-dlp binary not found.' };
    }

    console.log('[yt] using yt-dlp:', ytDlpPath);

    const p = spawn(ytDlpPath, args, {
      cwd: destDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    p.stdout.on('data', (d) => wc.send('yt:log', d.toString()));
    p.stderr.on('data', (d) => wc.send('yt:log', d.toString()));

    return await new Promise((resolve) => {
      p.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: `yt-dlp exited with code ${code}` });
      });
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('indexer:getState', async () => {
  try {
    return { ok: true, state: indexerQueries.getIndexerState() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:query', async (_evt, q, opts) => {
  try {
    const results = searchIndexer(q, opts || {});
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:getVolumeInfo', async (_evt, volumeUuid) => {
  try {
    const volume = indexerQueries.getVolumeByUuid(volumeUuid);
    return { ok: true, volume };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:getMediaInfo', async (_evt, filePath) => {
  try {
    const mediaInfo = await runFfprobe(filePath);
    return { ok: true, mediaInfo };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:getDirectoryContents', async (_evt, volumeUuid, rootPath, dirRelativePath) => {
  try {
    const files = indexerQueries.getDirectoryContents(volumeUuid, rootPath, dirRelativePath);
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:getDirectoryStats', async (_evt, volumeUuid, rootPath, dirRelativePath) => {
  try {
    const stats = indexerQueries.getDirectoryStats(volumeUuid, rootPath, dirRelativePath);
    return { ok: true, stats };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setVolumeActive', async (_evt, volumeUuid, isActive) => {
  try {
    return { ok: true, state: indexerQueries.setVolumeActive(volumeUuid, isActive) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setVolumeInterval', async (_evt, volumeUuid, intervalMs) => {
  try {
    return { ok: true, state: indexerQueries.setVolumeInterval(volumeUuid, intervalMs) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:addManualRoot', async (_evt, rootPath) => {
  try {
    return { ok: true, state: indexerQueries.addManualRoot(rootPath) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setManualRootActive', async (_evt, rootId, isActive) => {
  try {
    return { ok: true, state: indexerQueries.setManualRootActive(rootId, isActive) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setManualRootInterval', async (_evt, rootId, intervalMs) => {
  try {
    return { ok: true, state: indexerQueries.setManualRootInterval(rootId, intervalMs) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:removeManualRoot', async (_evt, rootId) => {
  try {
    return { ok: true, state: indexerQueries.removeManualRoot(rootId) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableVolume', async (_evt, volumeUuid) => {
  try {
    return { ok: true, state: indexerQueries.disableVolume(volumeUuid) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableAndDeleteVolumeData', async (_evt, volumeUuid) => {
  try {
    return { ok: true, state: indexerQueries.disableAndDeleteVolumeData(volumeUuid) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableManualRoot', async (_evt, rootId) => {
  try {
    return { ok: true, state: indexerQueries.disableManualRoot(rootId) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableAndDeleteManualRootData', async (_evt, rootId) => {
  try {
    return { ok: true, state: indexerQueries.disableAndDeleteManualRootData(rootId) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:scanAllNow', async () => {
  const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'scanAll' } });
  return { ok: queued };
});

ipcMain.handle('indexer:scanVolumeNow', async (_evt, volumeUuid) => {
  const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'volume', volumeUuid } });
  return { ok: queued };
});

ipcMain.handle('indexer:scanManualRootNow', async (_evt, rootId) => {
  const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'manualRoot', rootId } });
  return { ok: queued };
});

ipcMain.handle('indexer:status', async () => {
  // ask worker to send status; return the last known snapshot immediately after short delay
  sendWorkerMessage({ cmd: 'indexerStatus' });

  // small delay to allow worker to respond
  await new Promise(r => setTimeout(r, 50));

  return { ok: true, status: getLatestIndexerStatus() };
});

ipcMain.handle('indexer:cancelAll', async () => {
  const ok = sendWorkerMessage({ cmd: 'indexerCancelAll' });
  return { ok };
});

ipcMain.handle('indexer:cancelCurrent', async () => {
  const ok = sendWorkerMessage({ cmd: 'indexerCancelCurrent' });
  return { ok };
});

ipcMain.handle('indexer:cancelKey', async (_evt, key) => {
  const ok = sendWorkerMessage({ cmd: 'indexerCancelKey', key });
  return { ok };
});

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function runFfprobe(filePath) {
  return new Promise((resolve) => {
    console.log('[ffprobe] Running on:', filePath);

    if (!filePath) {
      console.log('[ffprobe] No file path provided');
      resolve({ error: 'No file path provided' });
      return;
    }

    if (!fs.existsSync(filePath)) {
      console.log('[ffprobe] File does not exist:', filePath);
      resolve({ error: 'File does not exist', path: filePath });
      return;
    }

    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    console.log('[ffprobe] Command:', ffprobePath, args.join(' '));
    const p = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';

    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });

    p.on('error', (err) => {
      console.log('[ffprobe] Spawn error:', err.message);
      resolve({ error: err.message });
    });

    p.on('close', (code) => {
      console.log('[ffprobe] Exit code:', code, 'stdout length:', stdout.length, 'stderr:', stderr);

      if (code !== 0) {
        resolve({ error: `ffprobe exited with code ${code}`, stderr });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
        const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');

        resolve({
          // Parsed fields
          duration: data.format?.duration,
          bitrate: data.format?.bit_rate,
          codec: videoStream?.codec_name,
          width: videoStream?.width,
          height: videoStream?.height,
          audioCodec: audioStream?.codec_name,
          audioSampleRate: audioStream?.sample_rate,
          audioChannels: audioStream?.channels,
          // Raw data for display
          format: data.format,
          streams: data.streams
        });
      } catch (e) {
        console.log('[ffprobe] JSON parse error:', e.message);
        resolve({ error: 'Failed to parse ffprobe output', raw: stdout });
      }
    });
  });
}

// Clip thumbnail cache
const CLIP_THUMB_CACHE_DIR = path.join(os.homedir(), 'Library', 'Caches', 'M24Tools', 'clip-thumbs');

function spawnFfmpegAsync(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { timeout: 30000 });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function generateClipThumbnails(filePath) {
  try {
    fs.mkdirSync(CLIP_THUMB_CACHE_DIR, { recursive: true });

    const hash = crypto.createHash('md5').update(filePath).digest('hex');
    const thumb1 = path.join(CLIP_THUMB_CACHE_DIR, `${hash}_1.jpg`);
    const thumb2 = path.join(CLIP_THUMB_CACHE_DIR, `${hash}_2.jpg`);

    // Check if already cached
    if (fs.existsSync(thumb1) && fs.existsSync(thumb2)) {
      return { ok: true, thumbs: [thumb1, thumb2] };
    }

    // Get duration first
    const mediaInfo = await runFfprobe(filePath);
    const duration = parseFloat(mediaInfo?.duration || 0);
    if (duration <= 0) {
      return { ok: false, error: 'Cannot determine duration' };
    }

    // Generate at 25% and 75% of duration
    const t1 = Math.max(0, Math.floor(duration * 0.25));
    const t2 = Math.max(0, Math.floor(duration * 0.75));

    await spawnFfmpegAsync(['-y', '-ss', String(t1), '-i', filePath, '-frames:v', '1', '-q:v', '2', thumb1]);
    await spawnFfmpegAsync(['-y', '-ss', String(t2), '-i', filePath, '-frames:v', '1', '-q:v', '2', thumb2]);

    return { ok: true, thumbs: [thumb1, thumb2] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

ipcMain.handle('search:generateClipThumbnails', async (_evt, filePath) => {
  return generateClipThumbnails(filePath);
});

// Batch thumbnail generation for directory listing (limited concurrency)
ipcMain.handle('search:generateBatchThumbnails', async (_evt, files) => {
  const VIDEO_EXTS = ['mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts'];
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic'];

  const results = {};
  const concurrency = 3;

  // Filter to media files only
  const mediaFiles = files.filter(f => {
    const ext = (f.ext || '').toLowerCase();
    return VIDEO_EXTS.includes(ext) || IMAGE_EXTS.includes(ext);
  });

  // Process in batches
  for (let i = 0; i < mediaFiles.length; i += concurrency) {
    const batch = mediaFiles.slice(i, i + concurrency);
    const promises = batch.map(async (file) => {
      const ext = (file.ext || '').toLowerCase();

      if (VIDEO_EXTS.includes(ext)) {
        // Generate video thumbnail (single frame at 25%)
        try {
          const hash = crypto.createHash('md5').update(file.path).digest('hex');
          const thumbPath = path.join(CLIP_THUMB_CACHE_DIR, `${hash}_thumb.jpg`);

          if (fs.existsSync(thumbPath)) {
            results[file.path] = thumbPath;
            return;
          }

          const mediaInfo = await runFfprobe(file.path);
          const duration = parseFloat(mediaInfo?.duration || 0);
          if (duration > 0) {
            const t = Math.max(0, Math.floor(duration * 0.25));
            await spawnFfmpegAsync(['-y', '-ss', String(t), '-i', file.path, '-frames:v', '1', '-vf', 'scale=120:-1', '-q:v', '3', thumbPath]);
            if (fs.existsSync(thumbPath)) {
              results[file.path] = thumbPath;
            }
          }
        } catch (e) {
          // Skip failed thumbnails
        }
      } else if (IMAGE_EXTS.includes(ext)) {
        // For images, just use the original file path (browser can display)
        results[file.path] = file.path;
      }
    });

    await Promise.all(promises);
  }

  return { ok: true, thumbnails: results };
});

ipcMain.handle('indexer:getSetting', async (_evt, key) => {
  try {
    return { ok: true, value: indexerQueries.getSetting(key) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setSetting', async (_evt, key, value) => {
  try {
    return { ok: true, result: indexerQueries.setSetting(key, value) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('system:checkFullDiskAccess', async () => {
  if (process.platform !== 'darwin') return { ok: true, hasFullDiskAccess: true, reason: 'non-macos' };

  const home = os.homedir();
  const probes = [
    path.join(home, 'Library', 'Mail'),
    path.join(home, 'Library', 'Messages'),
    path.join(home, 'Library', 'Safari')
  ];

  for (const p of probes) {
    try {
      if (fs.existsSync(p)) {
        fs.readdirSync(p); // will throw EPERM without FDA for protected areas
        return { ok: true, hasFullDiskAccess: true, reason: `readable:${p}` };
      }
    } catch (e) {
      if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
        return { ok: true, hasFullDiskAccess: false, reason: `denied:${p}` };
      }
    }
  }

  // If nothing exists or we couldn't determine, treat as false so we show prompt once.
  return { ok: true, hasFullDiskAccess: false, reason: 'indeterminate' };
});

ipcMain.handle('system:openFullDiskAccess', async () => {
  try {
    // Best shot deep-link
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
    return { ok: true };
  } catch (e) {
    try {
      // Fallback: open System Settings app
      await shell.openExternal('x-apple.systempreferences:');
      return { ok: true };
    } catch (e2) {
      return { ok: false, error: e2.message || String(e2) };
    }
  }
});

function getBundledYtDlpPath() {
  // dev path (repo)
  const devCandidate = path.join(__dirname, 'bin', 'yt-dlp-macos-arm64');

  // packaged path: if running inside app.asar, use app.asar.unpacked
  const packagedCandidate = devCandidate.includes('app.asar')
    ? devCandidate.replace('app.asar', 'app.asar.unpacked')
    : devCandidate;

  const candidate = app.isPackaged ? packagedCandidate : devCandidate;

  if (fs.existsSync(candidate)) {
    try { fs.chmodSync(candidate, 0o755); } catch {}
    return candidate;
  }

  return null;
}

// Whisper transcription support
const WHISPER_CACHE_DIR = path.join(os.homedir(), 'Library', 'Caches', 'M24Tools', 'whisper');

function getWhisperPath() {
  // Look for whisper binary in bin folder
  const devCandidate = path.join(__dirname, 'bin', 'whisper', 'whisper-cli');
  const packagedCandidate = devCandidate.includes('app.asar')
    ? devCandidate.replace('app.asar', 'app.asar.unpacked')
    : devCandidate;

  const candidate = app.isPackaged ? packagedCandidate : devCandidate;

  if (fs.existsSync(candidate)) {
    try { fs.chmodSync(candidate, 0o755); } catch {}
    return candidate;
  }

  // Also check for system-installed whisper.cpp
  const systemPaths = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
  for (const sp of systemPaths) {
    if (fs.existsSync(sp)) return sp;
  }

  return null;
}

function getWhisperModelPath() {
  // Look for ggml model in bin/whisper folder
  const devCandidate = path.join(__dirname, 'bin', 'whisper', 'ggml-base.bin');
  const packagedCandidate = devCandidate.includes('app.asar')
    ? devCandidate.replace('app.asar', 'app.asar.unpacked')
    : devCandidate;

  const candidate = app.isPackaged ? packagedCandidate : devCandidate;

  if (fs.existsSync(candidate)) return candidate;

  // Check common model locations
  const homePaths = [
    path.join(os.homedir(), '.cache', 'whisper', 'ggml-base.bin'),
    path.join(os.homedir(), 'Library', 'Caches', 'whisper', 'ggml-base.bin')
  ];
  for (const hp of homePaths) {
    if (fs.existsSync(hp)) return hp;
  }

  return null;
}

// Get cached transcription from DB
function getCachedTranscription(filePath) {
  try {
    const { openDb } = require('../indexer/worker/db/openDb');
    const db = openDb();
    const row = db.prepare('SELECT * FROM transcriptions WHERE file_path = ?').get(filePath);
    db.close();
    return row || null;
  } catch (e) {
    console.log('[transcribe] DB error:', e.message);
    return null;
  }
}

// Save transcription to DB
function saveTranscription(filePath, text, language, durationSec, model) {
  try {
    const { openDb } = require('../indexer/worker/db/openDb');
    const db = openDb();
    db.prepare(`
      INSERT INTO transcriptions (file_path, text, language, duration_sec, transcribed_at, model)
      VALUES (?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(file_path) DO UPDATE SET
        text = excluded.text,
        language = excluded.language,
        duration_sec = excluded.duration_sec,
        transcribed_at = excluded.transcribed_at,
        model = excluded.model
    `).run(filePath, text, language, durationSec, model);
    db.close();
    return true;
  } catch (e) {
    console.log('[transcribe] DB save error:', e.message);
    return false;
  }
}

// Extract audio from video to WAV for whisper (whisper.cpp requires WAV 16kHz mono)
async function extractAudioForWhisper(videoPath) {
  const hash = crypto.createHash('md5').update(videoPath).digest('hex');
  const wavPath = path.join(WHISPER_CACHE_DIR, `${hash}.wav`);

  // Return cached WAV if exists
  if (fs.existsSync(wavPath)) return wavPath;

  fs.mkdirSync(WHISPER_CACHE_DIR, { recursive: true });

  // Extract audio as 16kHz mono WAV
  await spawnFfmpegAsync([
    '-y', '-i', videoPath,
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    wavPath
  ]);

  return wavPath;
}

// Run whisper transcription
async function runWhisperTranscription(filePath, onProgress) {
  const whisperPath = getWhisperPath();
  const modelPath = getWhisperModelPath();

  if (!whisperPath) {
    return { ok: false, error: 'Whisper binary not found. Install whisper.cpp or place whisper-cli in electron/bin/whisper/' };
  }

  if (!modelPath) {
    return { ok: false, error: 'Whisper model not found. Download ggml-base.bin and place in electron/bin/whisper/' };
  }

  // Check for cached result
  const cached = getCachedTranscription(filePath);
  if (cached) {
    return { ok: true, text: cached.text, language: cached.language, cached: true };
  }

  if (onProgress) onProgress({ stage: 'preparing', message: 'Preparing audio...' });

  // Get file info
  const mediaInfo = await runFfprobe(filePath);
  const durationSec = parseFloat(mediaInfo?.duration || 0);

  // Extract audio to WAV
  let wavPath;
  try {
    wavPath = await extractAudioForWhisper(filePath);
  } catch (e) {
    return { ok: false, error: `Failed to extract audio: ${e.message}` };
  }

  if (onProgress) onProgress({ stage: 'transcribing', message: 'Running transcription...' });

  return new Promise((resolve) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-otxt',
      '-pp'  // Print progress
    ];

    console.log('[whisper] Running:', whisperPath, args.join(' '));

    const p = spawn(whisperPath, args, { timeout: 600000 }); // 10 min timeout
    let stdout = '';
    let stderr = '';

    p.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;

      // Parse progress if available
      if (onProgress && chunk.includes('%')) {
        const match = chunk.match(/(\d+)%/);
        if (match) {
          onProgress({ stage: 'transcribing', progress: parseInt(match[1], 10) });
        }
      }
    });

    p.stderr.on('data', (d) => { stderr += d; });

    p.on('error', (err) => {
      console.log('[whisper] Spawn error:', err.message);
      resolve({ ok: false, error: err.message });
    });

    p.on('close', (code) => {
      console.log('[whisper] Exit code:', code);

      if (code !== 0) {
        resolve({ ok: false, error: `Whisper exited with code ${code}`, stderr });
        return;
      }

      // Parse output - whisper outputs text to stdout
      const text = stdout.trim();

      // Detect language (whisper auto-detects)
      let language = 'en';
      const langMatch = stderr.match(/language:\s*(\w+)/i);
      if (langMatch) language = langMatch[1];

      // Save to cache
      saveTranscription(filePath, text, language, durationSec, 'base');

      resolve({ ok: true, text, language, cached: false });
    });
  });
}

ipcMain.handle('transcribe:request', async (evt, filePath) => {
  const wc = evt.sender;

  const onProgress = (p) => {
    wc.send('transcribe:progress', { filePath, ...p });
  };

  return runWhisperTranscription(filePath, onProgress);
});

ipcMain.handle('transcribe:getCached', async (_evt, filePath) => {
  const cached = getCachedTranscription(filePath);
  if (cached) {
    return { ok: true, text: cached.text, language: cached.language, transcribedAt: cached.transcribed_at };
  }
  return { ok: false, notCached: true };
});

ipcMain.handle('transcribe:checkAvailable', async () => {
  const whisperPath = getWhisperPath();
  const modelPath = getWhisperModelPath();

  return {
    ok: true,
    available: !!(whisperPath && modelPath),
    whisperPath: whisperPath || null,
    modelPath: modelPath || null
  };
});