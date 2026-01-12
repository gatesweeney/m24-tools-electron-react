console.log('Electron: starting');

require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
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
const { getSetting, setSetting, openSettingsDb } = require('../indexer/worker/db/settingsDb');
const { getThumbsDir, getLutsDir } = require('../indexer/worker/config/paths');
const worker = require('../indexer/worker/main');
const { sendWorkerMessage, getLatestIndexerStatus, onWorkerMessage } = require('./workerLauncher');

const ytDlpPath = resolveBin('bin/yt-dlp-macos-arm64');
const ffmpegPath = resolveBin('bin/ffmpeg-macos-arm64');
const ffprobePath = resolveBin('bin/ffprobe-macos-arm64');
const ffplayPath = resolveBin('bin/ffplay') || resolveBin('bin/ffplay-macos-arm64');

if (!ytDlpPath) throw new Error('yt-dlp binary missing');
if (!ffmpegPath) throw new Error('ffmpeg binary missing');
if (!ffprobePath) throw new Error('ffprobe binary missing');

const ffmpegDir = path.dirname(ffmpegPath);

const isDev = !app.isPackaged;
let mainWindow;

let tray = null;
let isQuitting = false;
let updateInProgress = false;
let lastUpdateStatus = { status: 'idle', info: null, progress: null, error: null };

const REMOTE_API_URL = 'https://api1.motiontwofour.com';
const REMOTE_API_ENABLED = process.env.M24_REMOTE_API_DISABLED !== '1';

async function remoteRequest(pathname, { method = 'GET', body } = {}) {
  if (!REMOTE_API_ENABLED || !REMOTE_API_URL) return { ok: false, error: 'remote_disabled' };
  const url = `${REMOTE_API_URL}${pathname}`;
  const headers = {};
  const token = getSetting('remote_api_token') || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    console.log('[remote] request', { method, url });
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    console.log('[remote] response', { url, status: res.status, ok: json?.ok });
    return json;
  } catch (err) {
    console.log('[remote] request failed', { url, message: err?.message || err });
    return { ok: false, error: 'fetch_failed' };
  }
}

function getRemoteDeviceId() {
  return getSetting('machine_id') || 'local';
}

const VOLUME_FIELDS = [
  'volume_uuid',
  'volume_name',
  'mount_point_last',
  'size_bytes',
  'fs_type',
  'first_seen_at',
  'last_seen_at',
  'last_scan_at',
  'scan_interval_ms',
  'is_active',
  'auto_purge',
  'auto_added',
  'tags',
  'physical_location',
  'notes',
  'signature',
  'signature_hint',
  'thumb1_path',
  'thumb2_path',
  'thumb3_path'
];

const MANUAL_ROOT_FIELDS = [
  'root_path',
  'path',
  'root_id',
  'label',
  'last_scan_at',
  'scan_interval_ms',
  'is_active',
  'notes'
];

function pickFields(source, fields) {
  const out = {};
  if (!source) return out;
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

function findVolumeInState(state, volumeUuid, deviceId) {
  const volumes = state?.volumes || [];
  if (deviceId) {
    return volumes.find((v) => v.volume_uuid === volumeUuid && v.device_id === deviceId) || null;
  }
  return volumes.find((v) => v.volume_uuid === volumeUuid) || null;
}

function findManualRootInState(state, rootId, deviceId) {
  const roots = state?.manualRoots || [];
  const match = (r) => `${r.root_id ?? r.id ?? ''}` === `${rootId ?? ''}`;
  if (deviceId) {
    return roots.find((r) => match(r) && r.device_id === deviceId) || null;
  }
  return roots.find((r) => match(r)) || null;
}

async function remoteFetchState() {
  console.log('[remote] fetch state', { scope: 'all' });
  return remoteRequest('/api/state');
}

async function remoteUpsertState({ volumes = [], manualRoots = [], files = [], deviceId } = {}) {
  console.log('[remote] upsert state', {
    volumes: volumes.length,
    manualRoots: manualRoots.length,
    files: files.length
  });
  return remoteRequest('/api/state/upsert', {
    method: 'POST',
    body: {
      deviceId: deviceId || getRemoteDeviceId(),
      volumes,
      manualRoots,
      files
    }
  });
}

async function remoteDeleteVolume(volumeUuid, deviceId) {
  return remoteRequest('/api/volume/delete', {
    method: 'POST',
    body: {
      volumeUuid,
      deviceId: deviceId || getRemoteDeviceId(),
      deleteFiles: true
    }
  });
}

async function remoteDeleteManualRoot(rootId, deviceId) {
  return remoteRequest('/api/manual-root/delete', {
    method: 'POST',
    body: {
      rootId,
      deviceId: deviceId || getRemoteDeviceId(),
      deleteFiles: true
    }
  });
}

function makeManualRootId(rootPath) {
  const deviceId = getRemoteDeviceId();
  const hash = crypto.createHash('sha256').update(`${deviceId}::${rootPath}`).digest('hex');
  const raw = BigInt(`0x${hash.slice(0, 16)}`);
  const max = BigInt('9223372036854775807');
  const id = raw % max;
  return (id === BigInt(0) ? BigInt(1) : id).toString();
}


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

function setupUpdater() {
  autoUpdater.autoDownload = false;

  const sendUpdateStatus = (partial) => {
    lastUpdateStatus = {
      ...lastUpdateStatus,
      ...partial
    };
    if (mainWindow) {
      mainWindow.webContents.send('updater:event', lastUpdateStatus);
    }
  };

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update');
    sendUpdateStatus({ status: 'checking', progress: null, error: null });
  });
  autoUpdater.on('update-available', (_evt, info) => {
    updateInProgress = true;
    console.log('[updater] update available');
    notify('Update available', 'Downloading update…');
    sendUpdateStatus({ status: 'available', info, progress: null, error: null });
    autoUpdater.downloadUpdate().catch((err) => {
      updateInProgress = false;
      console.log('[updater] download failed', err?.message || err);
      notify('Update failed', 'Could not download update.');
      sendUpdateStatus({ status: 'error', error: err?.message || String(err) });
    });
  });
  autoUpdater.on('update-not-available', () => {
    updateInProgress = false;
    console.log('[updater] no update available');
    notify('No updates', 'You are up to date.');
    sendUpdateStatus({ status: 'idle', error: null, progress: null });
  });
  autoUpdater.on('error', (err) => {
    updateInProgress = false;
    console.log('[updater] error', err?.message || err);
    notify('Update error', 'Update check failed.');
    sendUpdateStatus({ status: 'error', error: err?.message || String(err) });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      status: 'downloading',
      progress: {
        percent: progress?.percent,
        transferred: progress?.transferred,
        total: progress?.total
      }
    });
  });
  autoUpdater.on('update-downloaded', (_evt, info) => {
    updateInProgress = false;
    console.log('[updater] update downloaded');
    notify('Update ready', 'Restarting to install…');
    sendUpdateStatus({ status: 'downloaded', info, progress: null, error: null });
    setTimeout(() => autoUpdater.quitAndInstall(), 1500);
  });
}

function createAppMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Check for Updates…',
              click: () => {
                if (updateInProgress) {
                  notify('Update in progress', 'Please wait…');
                  return;
                }
                autoUpdater.checkForUpdates().catch((err) => {
                  console.log('[updater] check failed', err?.message || err);
                  notify('Update error', 'Update check failed.');
                });
              }
            },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help' }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
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
      label: 'Updates…',
      click: () => {
        if (!mainWindow) createWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('ui:showUpdateDialog');
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

  setupUpdater();
  createAppMenu();
  createWindow();

  ensureTray();

  startIndexerWorker();
  getLutsDir();
  startMaintenanceLoops();

  if (mainWindow) {
    mainWindow.setTitle('M24 Tools');
  }

  if (!isDev) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[updater] initial check failed', err?.message || err);
    });
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

ipcMain.handle('system:openWithApp', async (_evt, appName, filePath) => {
  try {
    if (!filePath || !appName) return { ok: false, error: 'Missing app or file path' };
    await new Promise((resolve, reject) => {
      const p = spawn('open', ['-a', appName, filePath]);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`open exited ${code}`))));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('fs:pathExists', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: true, exists: false };
    return { ok: true, exists: fs.existsSync(filePath) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('updater:check', async () => {
  if (isDev) return { ok: false, error: 'Update checks are disabled in dev mode.' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    console.log('[updater] check failed', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('updater:getStatus', async () => {
  return { ok: true, status: lastUpdateStatus };
});

ipcMain.handle('updater:quitAndInstall', async () => {
  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
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
    const remote = await remoteFetchState();
    if (remote?.ok) {
      return { ok: true, state: { drives: remote.volumes || [], roots: remote.manualRoots || [], devices: remote.devices || [] } };
    }
    return { ok: false, error: remote?.error || 'remote_unavailable' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:query', async (_evt, q, opts) => {
  try {
    const remote = await remoteRequest(`/api/search?q=${encodeURIComponent(q)}`);
    if (remote?.ok) return { ok: true, results: remote.results || [] };
    return { ok: false, error: remote?.error || 'remote_unavailable' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('search:getVolumeInfo', async (_evt, volumeUuid, deviceId) => {
  try {
    const encodedDeviceId = encodeURIComponent(deviceId || getRemoteDeviceId());
    const remote = await remoteRequest(`/api/volume?volumeUuid=${encodeURIComponent(volumeUuid)}&deviceId=${encodedDeviceId}`);
    if (remote?.ok) return { ok: true, volume: remote.volume || null };
    return { ok: false, error: remote?.error || 'remote_unavailable' };
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

ipcMain.handle('indexer:getDirectoryContents', async (_evt, volumeUuid, rootPath, dirRelativePath, deviceId) => {
  try {
    const encodedDeviceId = encodeURIComponent(deviceId || getRemoteDeviceId());
    const remote = await remoteRequest(`/api/dir/contents?volumeUuid=${encodeURIComponent(volumeUuid)}&rootPath=${encodeURIComponent(rootPath)}&dirRel=${encodeURIComponent(dirRelativePath || '')}&deviceId=${encodedDeviceId}`);
    if (remote?.ok) return { ok: true, files: remote.files || [] };
    return { ok: false, error: remote?.error || 'remote_unavailable' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:getDirectoryContentsRecursive', async (_evt, volumeUuid, rootPath, dirRelativePath, limit, offset, deviceId) => {
  try {
    const encodedDeviceId = encodeURIComponent(deviceId || getRemoteDeviceId());
    const remote = await remoteRequest(`/api/dir/contents_recursive?volumeUuid=${encodeURIComponent(volumeUuid)}&rootPath=${encodeURIComponent(rootPath)}&dirRel=${encodeURIComponent(dirRelativePath || '')}&limit=${limit || 250}&offset=${offset || 0}&deviceId=${encodedDeviceId}`);
    if (remote?.ok) return { ok: true, files: remote.files || [] };
    return { ok: false, error: remote?.error || 'remote_unavailable' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:getDirectoryStats', async (_evt, volumeUuid, rootPath, dirRelativePath, deviceId) => {
  try {
    const encodedDeviceId = encodeURIComponent(deviceId || getRemoteDeviceId());
    const remote = await remoteRequest(`/api/dir/stats?volumeUuid=${encodeURIComponent(volumeUuid)}&rootPath=${encodeURIComponent(rootPath)}&dirRel=${encodeURIComponent(dirRelativePath || '')}&deviceId=${encodedDeviceId}`);
    if (remote?.ok) return { ok: true, stats: remote.stats || {} };
    return { ok: false, error: remote?.error || 'remote_unavailable' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setVolumeActive', async (_evt, volumeUuid, isActive, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findVolumeInState(stateRes, volumeUuid, deviceId);
    if (!existing) return { ok: false, error: 'Volume not found.' };
    const updated = {
      ...pickFields(existing, VOLUME_FIELDS),
      volume_uuid: volumeUuid,
      is_active: isActive ? 1 : 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      volumes: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setVolumeInterval', async (_evt, volumeUuid, intervalMs, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findVolumeInState(stateRes, volumeUuid, deviceId);
    if (!existing) return { ok: false, error: 'Volume not found.' };
    const updated = {
      ...pickFields(existing, VOLUME_FIELDS),
      volume_uuid: volumeUuid,
      scan_interval_ms: intervalMs
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      volumes: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setVolumeAutoPurge', async (_evt, volumeUuid, enabled, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findVolumeInState(stateRes, volumeUuid, deviceId);
    if (!existing) return { ok: false, error: 'Volume not found.' };
    const updated = {
      ...pickFields(existing, VOLUME_FIELDS),
      volume_uuid: volumeUuid,
      auto_purge: enabled ? 1 : 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      volumes: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:addManualRoot', async (_evt, rootPath) => {
  try {
    const stateRes = await remoteFetchState();
    const existing = stateRes?.ok
      ? (stateRes.manualRoots || []).find((r) => r.path === rootPath)
      : null;
    if (existing) return { ok: true, root: existing };

    const rootId = makeManualRootId(rootPath);
    const record = {
      id: rootId,
      path: rootPath,
      label: path.basename(rootPath),
      is_active: 1
    };
    const remote = await remoteUpsertState({ manualRoots: [record] });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true, root: record };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setManualRootActive', async (_evt, rootId, isActive, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findManualRootInState(stateRes, rootId, deviceId);
    if (!existing) return { ok: false, error: 'Manual root not found.' };
    const rootPath = existing.root_path || existing.path;
    const updated = {
      ...pickFields(existing, MANUAL_ROOT_FIELDS),
      root_path: rootPath,
      path: existing.path || rootPath,
      root_id: existing.root_id || rootId,
      id: existing.root_id || rootId,
      is_active: isActive ? 1 : 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      manualRoots: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setManualRootInterval', async (_evt, rootId, intervalMs, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findManualRootInState(stateRes, rootId, deviceId);
    if (!existing) return { ok: false, error: 'Manual root not found.' };
    const rootPath = existing.root_path || existing.path;
    const updated = {
      ...pickFields(existing, MANUAL_ROOT_FIELDS),
      root_path: rootPath,
      path: existing.path || rootPath,
      root_id: existing.root_id || rootId,
      id: existing.root_id || rootId,
      scan_interval_ms: intervalMs
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      manualRoots: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setManualRootAutoPurge', async (_evt, rootId, enabled, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findManualRootInState(stateRes, rootId, deviceId);
    if (!existing) return { ok: false, error: 'Manual root not found.' };
    const rootPath = existing.root_path || existing.path;
    const updated = {
      ...pickFields(existing, MANUAL_ROOT_FIELDS),
      root_path: rootPath,
      path: existing.path || rootPath,
      root_id: existing.root_id || rootId,
      id: existing.root_id || rootId,
      auto_purge: enabled ? 1 : 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      manualRoots: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:removeManualRoot', async (_evt, rootId, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findManualRootInState(stateRes, rootId, deviceId);
    if (!existing) return { ok: false, error: 'Manual root not found.' };
    const rootPath = existing.root_path || existing.path;
    const updated = {
      ...pickFields(existing, MANUAL_ROOT_FIELDS),
      root_path: rootPath,
      path: existing.path || rootPath,
      root_id: existing.root_id || rootId,
      id: existing.root_id || rootId,
      is_active: 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      manualRoots: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableVolume', async (_evt, volumeUuid, deviceId) => {
  try {
    const remote = await remoteUpsertState({
      deviceId: deviceId || getRemoteDeviceId(),
      volumes: [{ volume_uuid: volumeUuid, is_active: 0, device_id: deviceId || getRemoteDeviceId() }]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableAndDeleteVolumeData', async (_evt, volumeUuid, deviceId) => {
  try {
    const remote = await remoteDeleteVolume(volumeUuid, deviceId);
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableManualRoot', async (_evt, rootId, deviceId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const existing = findManualRootInState(stateRes, rootId, deviceId);
    if (!existing) return { ok: false, error: 'Manual root not found.' };
    const rootPath = existing.root_path || existing.path;
    const updated = {
      ...pickFields(existing, MANUAL_ROOT_FIELDS),
      root_path: rootPath,
      path: existing.path || rootPath,
      root_id: existing.root_id || rootId,
      id: existing.root_id || rootId,
      is_active: 0
    };
    const targetDevice = deviceId || existing.device_id || getRemoteDeviceId();
    const remote = await remoteUpsertState({
      deviceId: targetDevice,
      manualRoots: [updated]
    });
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:disableAndDeleteManualRootData', async (_evt, rootId, deviceId) => {
  try {
    const remote = await remoteDeleteManualRoot(rootId, deviceId);
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:scanAllNow', async () => {
  const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'scanAll' } });
  return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
});

ipcMain.handle('indexer:scanAllWithThumbs', async () => {
  const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'scanAll', generateThumbs: true } });
  return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
});

ipcMain.handle('indexer:scanVolumeNow', async (_evt, volumeUuid) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const vol = (stateRes.volumes || []).find((v) => v.volume_uuid === volumeUuid);
    if (!vol) return { ok: false, error: 'Volume not found.' };
    const mountPoint = vol.mount_point_last;
    if (!mountPoint || !fs.existsSync(mountPoint)) {
      return { ok: false, error: 'Drive not connected.' };
    }
    const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'volume', volumeUuid } });
    return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:scanVolumeWithThumbs', async (_evt, volumeUuid) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const vol = (stateRes.volumes || []).find((v) => v.volume_uuid === volumeUuid);
    if (!vol) return { ok: false, error: 'Volume not found.' };
    const mountPoint = vol.mount_point_last;
    if (!mountPoint || !fs.existsSync(mountPoint)) {
      return { ok: false, error: 'Drive not connected.' };
    }
    const queued = sendWorkerMessage({
      cmd: 'manualScan',
      payload: { type: 'volume', volumeUuid, generateThumbs: true }
    });
    return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:ejectVolume', async (_evt, volumeUuid) => {
  try {
    if (process.platform !== 'darwin') return { ok: false, error: 'Unsupported platform.' };
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const vol = (stateRes.volumes || []).find((v) => v.volume_uuid === volumeUuid);
    if (!vol) return { ok: false, error: 'Volume not found.' };
    const mountPoint = vol.mount_point_last;
    if (!mountPoint || !fs.existsSync(mountPoint)) {
      return { ok: false, error: 'Drive not connected.' };
    }
    await new Promise((resolve, reject) => {
      const p = spawn('diskutil', ['eject', mountPoint]);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`diskutil exited ${code}`))));
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:scanManualRootNow', async (_evt, rootId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const root = (stateRes.manualRoots || []).find((r) => `${r.id}` === `${rootId}`);
    if (!root) return { ok: false, error: 'Manual root not found.' };
    if (!root.path || !fs.existsSync(root.path)) {
      return { ok: false, error: 'Folder not accessible.' };
    }
    const queued = sendWorkerMessage({ cmd: 'manualScan', payload: { type: 'manualRoot', rootId } });
    return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:scanManualRootWithThumbs', async (_evt, rootId) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const root = (stateRes.manualRoots || []).find((r) => `${r.id}` === `${rootId}`);
    if (!root) return { ok: false, error: 'Manual root not found.' };
    if (!root.path || !fs.existsSync(root.path)) {
      return { ok: false, error: 'Folder not accessible.' };
    }
    const queued = sendWorkerMessage({
      cmd: 'manualScan',
      payload: { type: 'manualRoot', rootId, generateThumbs: true }
    });
    return queued ? { ok: true } : { ok: false, error: 'Indexer worker not running.' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:normalizeManualRootId', async (_evt, rootPath) => {
  try {
    if (!rootPath) return { ok: false, error: 'missing_path' };
    return { ok: true, id: makeManualRootId(rootPath) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:listVolumeFiles', async (_evt, volumeUuid, limit = 500) => {
  try {
    const stateRes = await remoteFetchState();
    if (!stateRes?.ok) return { ok: false, error: stateRes?.error || 'remote_unavailable' };
    const vol = (stateRes.volumes || []).find((v) => v.volume_uuid === volumeUuid);
    if (!vol) return { ok: false, error: 'Volume not found.' };
    const rootPath = vol.mount_point_last;
    if (!rootPath) return { ok: false, error: 'Volume not mounted.' };
    const deviceId = encodeURIComponent(getRemoteDeviceId());
    const remote = await remoteRequest(`/api/dir/contents_recursive?volumeUuid=${encodeURIComponent(volumeUuid)}&rootPath=${encodeURIComponent(rootPath)}&dirRel=&limit=${limit || 500}&offset=0&deviceId=${deviceId}`);
    if (!remote?.ok) return { ok: false, error: remote?.error || 'remote_unavailable' };
    return { ok: true, files: remote.files || [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
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

// Shared thumbnail cache (stored under Documents/M24Index/thumbs)
const CLIP_THUMB_CACHE_DIR = getThumbsDir();

function todayStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function waveformCachePath(filePath, stats) {
  const sig = `${filePath}|${stats?.size || 0}|${stats?.mtimeMs || 0}`;
  const hash = crypto.createHash('md5').update(sig).digest('hex');
  return path.join(CLIP_THUMB_CACHE_DIR, `waveform_${hash}.json`);
}

function waveformImagePath(filePath, stats, opts = {}) {
  const sig = `${filePath}|${stats?.size || 0}|${stats?.mtimeMs || 0}|${opts.width || 0}x${opts.height || 0}|${opts.colors || ''}|${opts.gainDb || 0}`;
  const hash = crypto.createHash('md5').update(sig).digest('hex');
  return path.join(CLIP_THUMB_CACHE_DIR, `waveform_${hash}.png`);
}

function readThumbCacheMaxBytes() {
  const raw = getSetting('thumb_cache_max_gb');
  const num = parseFloat(raw || '0');
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num * 1024 * 1024 * 1024);
}

function getProtectedThumbsSet() {
  return new Set();
}

function runThumbCacheMaintenance() {
  try {
    const maxBytes = readThumbCacheMaxBytes();
    if (!maxBytes) return;

    if (!fs.existsSync(CLIP_THUMB_CACHE_DIR)) return;

    const protectedThumbs = getProtectedThumbsSet();
    const entries = fs.readdirSync(CLIP_THUMB_CACHE_DIR);
    const files = [];

    for (const name of entries) {
      const full = path.join(CLIP_THUMB_CACHE_DIR, name);
      let stat = null;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;
      if (protectedThumbs.has(path.resolve(full))) continue;
      files.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
    }

    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= maxBytes) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch {}
      total -= f.size;
      if (total <= maxBytes) break;
    }
  } catch (e) {
    console.log('[thumb-cache] cleanup failed', e?.message || e);
  }
}

function runAutoPurgeMaintenance() {
  try {
    const raw = getSetting('volume_purge_age_days');
    const days = parseInt(raw || '0', 10);
    if (!Number.isFinite(days) || days <= 0) return;
    // Purge is now handled server-side; no local DB data to clean.
  } catch (e) {
    console.log('[auto-purge] failed', e?.message || e);
  }
}

function startMaintenanceLoops() {
  runThumbCacheMaintenance();
  runAutoPurgeMaintenance();
  const hourMs = 60 * 60 * 1000;
  setInterval(runThumbCacheMaintenance, hourMs);
  setInterval(runAutoPurgeMaintenance, hourMs);
}

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

async function generateClipThumbnails(filePath, opts = {}) {
  try {
    fs.mkdirSync(CLIP_THUMB_CACHE_DIR, { recursive: true });

    const datePrefix = todayStamp();
    const hash = crypto.createHash('md5').update(filePath).digest('hex');
    const countRaw = parseInt(opts.count, 10);
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(countRaw, 12)) : 8;

    // Get duration first
    const mediaInfo = await runFfprobe(filePath);
    const duration = parseFloat(mediaInfo?.duration || 0);
    if (duration <= 0) {
      return { ok: false, error: 'Cannot determine duration' };
    }

    const times = [];
    const thumbs = [];
    for (let i = 0; i < count; i += 1) {
      const t = Math.max(0, Math.floor(((i + 1) / (count + 1)) * duration));
      const thumbPath = path.join(CLIP_THUMB_CACHE_DIR, `${datePrefix}_${hash}_clip${i + 1}.jpg`);
      if (!fs.existsSync(thumbPath)) {
        await spawnFfmpegAsync(['-y', '-ss', String(t), '-i', filePath, '-frames:v', '1', '-q:v', '2', thumbPath]);
      }
      if (fs.existsSync(thumbPath)) {
        thumbs.push(thumbPath);
        times.push(t);
      }
    }

    return { ok: true, thumbs, times };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

ipcMain.handle('search:generateClipThumbnails', async (_evt, filePath, opts) => {
  return generateClipThumbnails(filePath, opts);
});

// Batch thumbnail generation for directory listing (limited concurrency)
ipcMain.handle('search:generateBatchThumbnails', async (_evt, files) => {
  const VIDEO_EXTS = ['mp4', 'mov', 'mxf', 'mkv', 'avi', 'webm', 'mts', 'm2ts'];
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'heic'];

  const results = {};
  const concurrency = 3;
  const datePrefix = todayStamp();
  try { fs.mkdirSync(CLIP_THUMB_CACHE_DIR, { recursive: true }); } catch {}

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
          const thumbPath = path.join(CLIP_THUMB_CACHE_DIR, `${datePrefix}_${hash}_dir.jpg`);

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
        try {
          const hash = crypto.createHash('md5').update(file.path).digest('hex');
          const thumbPath = path.join(CLIP_THUMB_CACHE_DIR, `${datePrefix}_${hash}_img.jpg`);
          if (fs.existsSync(thumbPath)) {
            results[file.path] = thumbPath;
            return;
          }
          await spawnFfmpegAsync(['-y', '-i', file.path, '-frames:v', '1', '-vf', 'scale=120:-1', '-q:v', '3', thumbPath]);
          if (fs.existsSync(thumbPath)) {
            results[file.path] = thumbPath;
          }
        } catch (e) {
          // Skip failed thumbnails
        }
      }
    });

    await Promise.all(promises);
  }

  return { ok: true, thumbnails: results };
});

ipcMain.handle('media:getWaveformCache', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing file path' };
    const stats = fs.statSync(filePath);
    const cachePath = waveformCachePath(filePath, stats);
    if (!fs.existsSync(cachePath)) return { ok: true, peaks: null, duration: null };
    const raw = fs.readFileSync(cachePath, 'utf8');
    const data = JSON.parse(raw);
    return { ok: true, peaks: data.peaks || null, duration: data.duration || null };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('media:setWaveformCache', async (_evt, filePath, payload) => {
  try {
    if (!filePath || !payload) return { ok: false, error: 'Missing data' };
    const stats = fs.statSync(filePath);
    const cachePath = waveformCachePath(filePath, stats);
    fs.mkdirSync(CLIP_THUMB_CACHE_DIR, { recursive: true });
    const out = {
      duration: payload.duration || 0,
      peaks: Array.isArray(payload.peaks) ? payload.peaks : []
    };
    fs.writeFileSync(cachePath, JSON.stringify(out));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('media:generateWaveformImage', async (_evt, filePath, opts = {}) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing file path' };
    const stats = fs.statSync(filePath);
    const width = Math.max(200, Math.min(parseInt(opts.width, 10) || 900, 2000));
    const height = Math.max(60, Math.min(parseInt(opts.height, 10) || 120, 400));
    const outPath = waveformImagePath(filePath, stats, { width, height, colors: opts.colors, gainDb: opts.gainDb });
    if (fs.existsSync(outPath)) return { ok: true, path: outPath };

    fs.mkdirSync(CLIP_THUMB_CACHE_DIR, { recursive: true });
    const colors = opts.colors || opts.color || '#7ea0b7';
    const gainDb = Number.isFinite(Number(opts.gainDb)) ? Number(opts.gainDb) : 0;
    const gainFilter = gainDb !== 0 ? `volume=${gainDb}dB,` : '';
    const filter = `${gainFilter}showwavespic=s=${width}x${height}:colors=${colors},format=rgba`;

    await spawnFfmpegAsync([
      '-y',
      '-i', filePath,
      '-filter_complex', filter,
      '-frames:v', '1',
      '-color_range', 'pc',
      outPath
    ]);

    if (!fs.existsSync(outPath)) {
      return { ok: false, error: 'Waveform render failed' };
    }

    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('media:playWithFfplay', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing file path' };
    const exe = ffplayPath || 'ffplay';
    const args = ['-sync', 'ext', '-fflags', 'nobuffer', '-flags', 'low_delay', filePath];
    const p = spawn(exe, args, { stdio: 'ignore', detached: true });
    p.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('media:ensureProxyMp4', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing file path' };
    const stats = fs.statSync(filePath);
    const sig = `${filePath}|${stats.size}|${stats.mtimeMs}`;
    const hash = crypto.createHash('md5').update(sig).digest('hex');
    const outDir = path.join(CLIP_THUMB_CACHE_DIR, 'proxies');
    const outPath = path.join(outDir, `${hash}.mp4`);
    if (fs.existsSync(outPath)) return { ok: true, path: outPath };

    fs.mkdirSync(outDir, { recursive: true });

    await new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', filePath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        outPath
      ];
      const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0 && fs.existsSync(outPath)) resolve();
        else reject(new Error(stderr || `ffmpeg exited ${code}`));
      });
    });

    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:getSetting', async (_evt, key) => {
  try {
    return { ok: true, value: getSetting(key) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('indexer:setSetting', async (_evt, key, value) => {
  try {
    return { ok: true, result: setSetting(key, value) };
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

ipcMain.handle('system:getMountedVolumes', async () => {
  try {
    const { getUnifiedMounts } = require('../indexer/worker/platform/mounts');
    const mounts = getUnifiedMounts().filter((m) => m.kind === 'volume');
    return { ok: true, mounts };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('system:openPath', async (_evt, filePath) => {
  try {
    if (!filePath) return { ok: false, error: 'Missing path.' };
    await shell.openPath(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
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
    const db = openSettingsDb();
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
    const db = openSettingsDb();
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
