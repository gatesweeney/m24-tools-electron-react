const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const shell = require('electron').shell;
const { spawn } = require('child_process');
const os = require('os');
const { runProxyJob } = require('./fs-ops');
const { getInfoJson, normalizeFormats, downloadWithFormat } = require('./ytdlp');
const { resolveBin } = require('./binPath');
const { startIndexerWorker } = require('./workerLauncher');
const indexerService = require('./indexerService');
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

onWorkerMessage((msg) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (msg && msg.cmd === 'indexerProgress') {
    mainWindow.webContents.send('indexer:progress', msg);
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

app.whenReady().then(() => {
  app.setName('M24 Tools');

  createWindow();

  startIndexerWorker();

  if (mainWindow) {
    mainWindow.setTitle('M24 Tools');
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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

ipcMain.handle('indexerService:status', async () => indexerService.status());
ipcMain.handle('indexerService:install', async () => indexerService.install());
ipcMain.handle('indexerService:uninstall', async () => indexerService.uninstall());
ipcMain.handle('indexerService:restart', async () => indexerService.restart());

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