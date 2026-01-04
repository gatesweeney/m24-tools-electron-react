const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const shell = require('electron').shell;
const { spawn } = require('child_process');
const os = require('os');
const { runProxyJob } = require('./fs-ops');
const { scanOffshootLogs } = require('./offshoot-logs');
const { getIndexerState, scanNow, searchFiles } = require('../indexer/uiApi');
const { getInfoJson, normalizeFormats, downloadWithFormat } = require('./ytdlp');
const { resolveBin } = require('./binPath');

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

ipcMain.handle('offshoot:scan', async (event, rootFolder) => {
  try {
    const results = await scanOffshootLogs(rootFolder);
    return { ok: true, results };
  } catch (err) {
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

ipcMain.handle('indexer:getState', async () => {
  try {
    const state = await getIndexerState();
    return { ok: true, state };
  } catch (err) {
    console.error('[indexer] getState error:', err);
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('indexer:scanNow', async (event, rootPath) => {
  try {
    const result = await scanNow(rootPath);
    return { ok: true, result };
  } catch (err) {
    console.error('[indexer] scanNow error:', err);
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('indexer:searchFiles', async (event, query, limit) => {
  try {
    const results = await searchFiles(query, limit || 200);
    return { ok: true, results };
  } catch (err) {
    console.error('[indexer] searchFiles error:', err);
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

    const format = mode === 'video' ? "(bv*[vcodec~='^((he|a)vc|h26[45])']+ba) / (bv*+ba/b) --merge-output-format mp4 --recode-video=mp4" : 'ba';
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