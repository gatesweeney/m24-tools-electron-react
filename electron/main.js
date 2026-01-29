function handlePipeError(err) {
  if (err && err.code === 'EPIPE') return;
  try { console.error('[electron] stdout/stderr error', err); } catch {}
}

if (process.stdout) process.stdout.on('error', handlePipeError);
if (process.stderr) process.stderr.on('error', handlePipeError);

process.on('uncaughtException', (err) => {
  if (err && err.code === 'EPIPE') return;
  try { console.error('[electron] uncaught exception', err); } catch {}
});

console.log('Electron: starting');

require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const shell = require('electron').shell;
const { spawn } = require('child_process');
const os = require('os');
const net = require('net');
const { runProxyJob } = require('./fs-ops');
const { getInfoJson, normalizeFormats, downloadWithFormat } = require('./ytdlp');
const { resolveBin } = require('./binPath');
const { getBundledBinDir } = require('./binResolver');
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
const MENUBAR_ONLY = process.platform === 'darwin' && process.env.M24_MENUBAR_ONLY !== '0';
const AUTO_LAUNCH = process.platform === 'darwin' && !isDev && process.env.M24_AUTO_LAUNCH !== '0';
let mainWindow;

let tray = null;
let isQuitting = false;
let updateInProgress = false;
let lastUpdateStatus = { status: 'idle', info: null, progress: null, error: null };
const crocTransfers = new Map();
const crocLogs = [];
const MAX_CROC_LOGS = 400;
const sharePendingBySecret = new Map();
const crocShareByTransfer = new Map();
const shareReceiveInFlight = new Map();
const pendingDeepLinks = [];
let relaySocket = null;
let relayHeartbeat = null;
let relayReconnectTimer = null;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const urlArg = argv.find((arg) => typeof arg === 'string' && arg.startsWith('m24://'));
    if (urlArg) {
      if (app.isReady()) {
        handleIncomingLink(urlArg);
      } else {
        pendingDeepLinks.push(urlArg);
      }
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

const initialArg = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('m24://'));
if (initialArg) {
  pendingDeepLinks.push(initialArg);
}

const REMOTE_API_URL = process.env.M24_REMOTE_API_URL || 'https://api1.motiontwofour.com';
const REMOTE_API_ENABLED = process.env.M24_REMOTE_API_DISABLED !== '1';
const RELAY_BASE_URL = process.env.M24_RELAY_URL || REMOTE_API_URL;
const RELAY_WS_URL = process.env.M24_RELAY_WS_URL
  || (RELAY_BASE_URL ? RELAY_BASE_URL.replace(/^http/i, 'ws') : '');
const USE_SHARE_SECRET_AS_CROC_CODE = process.env.M24_CROC_USE_SHARE_CODE !== '0';
const DEFAULT_CROC_RELAY = process.env.M24_CROC_RELAY || 'relay1.motiontwofour.com:9009';
const DEFAULT_CROC_PASS = process.env.M24_CROC_PASS || 'jfogtorkwnxjfkrmemwikflglemsjdikfkemwja';

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

function getRelayToken() {
  return getSetting('remote_api_token') || '';
}

function getRelayDeviceName() {
  return getSetting('machine_name') || os.hostname();
}

async function postCandidate(secretId, hasAccess, priority = 0) {
  if (!secretId) return;
  const deviceId = getRemoteDeviceId();
  await relayRequest(`/api/transfers/shares/${secretId}/candidates`, {
    method: 'POST',
    body: { deviceId, hasAccess, priority }
  });
}

async function checkShareAccess(secretId) {
  if (!secretId) return { hasAccess: false };
  let pending = sharePendingBySecret.get(secretId);
  if (!pending) {
    pending = loadPendingShare(secretId) || null;
    if (pending) sharePendingBySecret.set(secretId, pending);
  }
  if (!pending || !pending.paths || !pending.paths.length) {
    return { hasAccess: false };
  }
  for (const p of pending.paths) {
    const full = expandHome(p);
    if (!fs.existsSync(full)) return { hasAccess: false };
  }
  return { hasAccess: true, pending };
}

function startCandidateCheck(secretId) {
  if (!secretId || !relaySocket || relaySocket.readyState !== WebSocket.OPEN) return;
  const requestId = crypto.randomBytes(8).toString('hex');
  try {
    relaySocket.send(JSON.stringify({ type: 'candidate_check', secretId, requestId }));
  } catch {}
}

function shouldStartMinimized() {
  const env = String(process.env.M24_START_MINIMIZED || '').toLowerCase();
  if (['1', 'true', 'yes'].includes(env)) return true;
  if (['0', 'false', 'no'].includes(env)) return false;
  const stored = String(getSetting('start_minimized') || '').toLowerCase();
  return ['1', 'true', 'yes'].includes(stored);
}

function getCrocRelaySetting() {
  return getSetting('transfers_croc_relay') || DEFAULT_CROC_RELAY;
}

function getCrocPassphraseSetting() {
  return getSetting('transfers_croc_pass') || DEFAULT_CROC_PASS;
}

function pendingShareKey(secretId) {
  return secretId ? `transfer_pending_${secretId}` : null;
}

function savePendingShare(secretId, pending) {
  if (!secretId) return;
  try {
    setSetting(pendingShareKey(secretId), JSON.stringify(pending || {}));
  } catch {}
}

function loadPendingShare(secretId) {
  if (!secretId) return null;
  try {
    const raw = getSetting(pendingShareKey(secretId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPendingShare(secretId) {
  if (!secretId) return;
  try {
    setSetting(pendingShareKey(secretId), '');
  } catch {}
}

function updateDockVisibility() {
  if (!app.dock) return;
  const visible = BrowserWindow.getAllWindows().some((win) => win && !win.isDestroyed() && win.isVisible());
  if (visible) app.dock.show();
  else app.dock.hide();
}

function parseHostPort(input, fallbackPort) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      return { host: url.hostname, port: Number(url.port) || fallbackPort || 80 };
    }
  } catch {}
  const withoutPath = raw.split('/')[0];
  const parts = withoutPath.split(':');
  if (parts.length === 1) return { host: parts[0], port: fallbackPort || 80 };
  const port = Number(parts.pop());
  return { host: parts.join(':'), port: Number.isFinite(port) ? port : (fallbackPort || 80) };
}

function checkTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve({ ok: false, latencyMs: null });
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function checkRelayHealth() {
  if (!RELAY_BASE_URL) return { ok: false, latencyMs: null };
  const url = `${RELAY_BASE_URL.replace(/\/$/, '')}/healthz`;
  const controller = new AbortController();
  const start = Date.now();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkCrocRelay() {
  const relay = getCrocRelaySetting();
  const parsed = parseHostPort(relay, 9009);
  if (!parsed) return { ok: false, latencyMs: null };
  return checkTcp(parsed.host, parsed.port, 2500);
}

async function relayRequest(pathname, { method = 'GET', body } = {}) {
  if (!RELAY_BASE_URL) return { ok: false, error: 'relay_url_missing' };
  const url = `${RELAY_BASE_URL}${pathname}`;
  const headers = {};
  const token = getRelayToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: json?.error || `http_${res.status}` };
    }
    if (!json) return { ok: false, error: 'invalid_response' };
    return json;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
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
    setTimeout(() => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }, 1500);
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

function resolveCrocPath() {
  if (process.env.M24_CROC_PATH) return process.env.M24_CROC_PATH;
  const platform = process.platform;
  const arch = process.arch;
  const candidates = [];

  if (platform === 'darwin') {
    if (arch === 'arm64') candidates.push('bin/croc-macos-arm64');
    if (arch === 'x64') candidates.push('bin/croc-macos-x64', 'bin/croc-macos-amd64');
  } else if (platform === 'win32') {
    if (arch === 'arm64') candidates.push('bin/croc-win-arm64.exe');
    candidates.push('bin/croc-win-64.exe', 'bin/croc-win-amd64.exe');
  } else if (platform === 'linux') {
    if (arch === 'arm64') candidates.push('bin/croc-linux-arm64');
    candidates.push('bin/croc-linux-64', 'bin/croc-linux-amd64');
  }

  for (const rel of candidates) {
    const resolved = resolveBin(rel);
    if (resolved) return resolved;
  }

  try {
    const { devDir, prodDir } = getBundledBinDir();
    const dir = app.isPackaged ? prodDir : devDir;
    const entries = fs.readdirSync(dir);
    const match = entries.find((name) => name.startsWith('croc'));
    if (match) {
      const resolved = resolveBin(path.join('bin', match));
      if (resolved) return resolved;
    }
  } catch {}

  return null;
}

function broadcastCrocEvent(event) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('croc:event', event);
    }
  }
}

function pushCrocLog(id, line, stream = 'stdout') {
  const entry = { id, line, stream, ts: Date.now() };
  crocLogs.push(entry);
  if (crocLogs.length > MAX_CROC_LOGS) crocLogs.splice(0, crocLogs.length - MAX_CROC_LOGS);
  broadcastCrocEvent({ type: 'log', ...entry });
}

function updateCrocTransfer(id, patch) {
  const current = crocTransfers.get(id) || { id };
  const next = { ...current, ...patch, updatedAt: Date.now() };
  crocTransfers.set(id, next);
  broadcastCrocEvent({ type: 'transfer', transfer: next });
  return next;
}

function parseCrocCode(line) {
  const match = line.match(/code is:\s*([a-z0-9-]+)/i) || line.match(/code:\s*([a-z0-9-]+)/i);
  return match ? match[1] : null;
}

async function statPathRecursive(target) {
  const info = await fs.promises.stat(target);
  if (info.isFile()) {
    return { bytes: info.size, files: 1 };
  }
  if (!info.isDirectory()) {
    return { bytes: 0, files: 0 };
  }
  let bytes = 0;
  let files = 0;
  const entries = await fs.promises.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    if (entry.isFile()) {
      const stat = await fs.promises.stat(entryPath);
      bytes += stat.size;
      files += 1;
    } else if (entry.isDirectory()) {
      const nested = await statPathRecursive(entryPath);
      bytes += nested.bytes;
      files += nested.files;
    }
  }
  return { bytes, files };
}

async function getPathsSummary(paths) {
  let totalBytes = 0;
  let fileCount = 0;
  for (const p of paths) {
    try {
      const resolved = expandHome(p);
      const stats = await statPathRecursive(resolved);
      totalBytes += stats.bytes;
      fileCount += stats.files;
    } catch {}
  }
  const displayName = paths.length === 1 ? path.basename(paths[0]) : `${paths.length} items`;
  return { totalBytes, fileCount, displayName };
}

function startCrocProcess({
  direction,
  paths = [],
  code,
  dest,
  relay,
  passphrase,
  zip = false,
  yes = true,
  overwrite = false,
  onCode,
  onExit
}) {
  const crocPath = resolveCrocPath();
  if (!crocPath) {
    throw new Error('Croc binary not found. Place it in electron/bin.');
  }
  try {
    const stat = fs.statSync(crocPath);
    console.log('[croc] binary', { path: crocPath, mode: stat.mode, size: stat.size });
  } catch (err) {
    console.log('[croc] binary stat failed', { path: crocPath, error: err?.message || String(err) });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const args = [];
  const classic = String(process.env.M24_CROC_CLASSIC || '0').toLowerCase() !== '0';

  if (relay) args.push('--relay', relay);
  if (passphrase) args.push('--pass', passphrase);
  if (classic) args.push('--classic');
  if (String(process.env.M24_CROC_DEBUG || '').toLowerCase() === '1') {
    args.push('--debug');
  }
  if (overwrite) args.push('--overwrite');
  if (yes) args.push('--yes');
  if (dest) args.push('--out', expandHome(dest));

  if (direction === 'send') {
    args.push('send');
    if (code) args.push('--code', code);
    if (zip) args.push('--zip');
    for (const p of paths) {
      args.push(expandHome(p));
    }
  } else {
    if (classic) {
      if (code) args.push(code);
    }
  }

  console.log('[croc] start', {
    id,
    direction,
    paths: paths.length,
    dest: dest || null,
    relay: relay || null,
    code: code || null,
    passphrase: passphrase ? 'set' : null,
    zip: Boolean(zip),
    args
  });

  const transfer = updateCrocTransfer(id, {
    id,
    direction,
    status: 'starting',
    code: code || null,
    paths,
    dest: dest || null,
    startedAt: Date.now()
  });

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

  if (!classic && direction === 'receive' && code) {
    env.CROC_SECRET = code;
  }
  const proc = spawn(crocPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.on('spawn', () => {
    console.log('[croc] spawned', { id, pid: proc.pid });
  });
  transfer.pid = proc.pid;
  updateCrocTransfer(id, { status: 'running' });

  let codeEmitted = false;
  let lastStdout = '';
  let lastStderr = '';
  proc.stdout.on('data', (d) => {
    const line = d.toString();
    lastStdout = line.slice(-2000);
    console.log('[croc] stdout', { id, line: line.trim() });
    pushCrocLog(id, line, 'stdout');
    const detected = parseCrocCode(line);
    if (detected && !crocTransfers.get(id)?.code) {
      updateCrocTransfer(id, { code: detected });
      broadcastCrocEvent({ type: 'code', id, code: detected });
      if (!codeEmitted && typeof onCode === 'function') {
        codeEmitted = true;
        try { onCode(detected); } catch {}
      }
    }
  });

  proc.stderr.on('data', (d) => {
    const line = d.toString();
    lastStderr = line.slice(-2000);
    console.log('[croc] stderr', { id, line: line.trim() });
    pushCrocLog(id, line, 'stderr');
    const detected = parseCrocCode(line);
    if (detected && !crocTransfers.get(id)?.code) {
      updateCrocTransfer(id, { code: detected });
      broadcastCrocEvent({ type: 'code', id, code: detected });
      if (!codeEmitted && typeof onCode === 'function') {
        codeEmitted = true;
        try { onCode(detected); } catch {}
      }
    }
  });

  proc.on('error', (err) => {
    console.log('[croc] spawn error', {
      id,
      message: err?.message || String(err),
      code: err?.code,
      errno: err?.errno,
      syscall: err?.syscall,
      path: err?.path
    });
    updateCrocTransfer(id, { status: 'error', error: err?.message || String(err) });
  });

  proc.on('close', (code, signal) => {
    const transfer = crocTransfers.get(id) || {};
    const status = transfer.cancelled ? 'cancelled' : (code === 0 ? 'completed' : 'failed');
    console.log('[croc] exit', {
      id,
      code,
      signal,
      status,
      lastStdout: lastStdout.trim() || null,
      lastStderr: lastStderr.trim() || null
    });
    updateCrocTransfer(id, { status, exitCode: code, signal });
    if (typeof onExit === 'function') {
      try { onExit({ status, exitCode: code, signal }); } catch {}
    }
  });

  updateCrocTransfer(id, { args });
  return updateCrocTransfer(id, { status: 'running' });
}

function broadcastShareEvent(event) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('transfer:shareEvent', event);
    }
  }
}

async function startShareSend(share) {
  if (!share?.secretId) return;
  let pending = sharePendingBySecret.get(share.secretId);
  if (!pending) {
    pending = loadPendingShare(share.secretId) || null;
    if (pending) {
      sharePendingBySecret.set(share.secretId, pending);
    }
  }
  if (!pending || pending.started) return;
  pending.started = true;
  const crocRelay = getCrocRelaySetting();
  const crocPassphrase = getCrocPassphraseSetting();
  const shareCode = USE_SHARE_SECRET_AS_CROC_CODE ? share.secretId : undefined;
  console.log('[transfer] start send', {
    secretId: share.secretId,
    relay: crocRelay || null,
    passphrase: crocPassphrase ? 'set' : null,
    code: shareCode || null,
    paths: pending.paths?.length || 0
  });
  const statusRes = await relayRequest(`/api/transfers/shares/${share.secretId}/status`, {
    method: 'POST',
    body: { status: 'sending' }
  });
  if (!statusRes?.ok) {
    console.log('[transfer] status update failed', { secretId: share.secretId, error: statusRes?.error });
  }

  const transfer = startCrocProcess({
    direction: 'send',
    paths: pending.paths || [],
    relay: crocRelay || undefined,
    passphrase: crocPassphrase || undefined,
    zip: share.receiverDeviceId === 'browser',
    code: shareCode,
    onCode: USE_SHARE_SECRET_AS_CROC_CODE ? undefined : async (code) => {
      await relayRequest(`/api/transfers/shares/${share.secretId}/croc`, {
        method: 'POST',
        body: { crocCode: code, crocPassphrase: crocPassphrase || undefined }
      });
    },
    onExit: async ({ status }) => {
      await relayRequest(`/api/transfers/shares/${share.secretId}/status`, {
        method: 'POST',
        body: { status }
      });
      if (status !== 'completed') {
        await fallbackStartSender(share.secretId);
      }
      clearPendingShare(share.secretId);
    }
  });

  crocShareByTransfer.set(transfer.id, { secretId: share.secretId, role: 'send' });
}

async function startShareReceive(share) {
  if (!share?.secretId) return;
  const shareCode = share.crocCode || (USE_SHARE_SECRET_AS_CROC_CODE ? share.secretId : null);
  if (!shareCode) return;
  if (shareReceiveInFlight.has(share.secretId)) return;
  shareReceiveInFlight.set(share.secretId, true);

  const dest = getSetting('transfers_download_dir')
    || path.join(os.homedir(), 'Downloads');
  const crocRelay = getCrocRelaySetting();
  const crocPassphrase = share.crocPassphrase || getCrocPassphraseSetting();
  console.log('[transfer] start receive', {
    secretId: share.secretId,
    relay: crocRelay || null,
    passphrase: crocPassphrase ? 'set' : null,
    code: shareCode || null,
    dest
  });

  const transfer = startCrocProcess({
    direction: 'receive',
    code: shareCode,
    passphrase: crocPassphrase || undefined,
    dest,
    relay: crocRelay || undefined,
    onExit: async ({ status }) => {
      await relayRequest(`/api/transfers/shares/${share.secretId}/status`, {
        method: 'POST',
        body: { status }
      });
      shareReceiveInFlight.delete(share.secretId);
    }
  });

  crocShareByTransfer.set(transfer.id, { secretId: share.secretId, role: 'receive' });
}

async function pollShareForReceiver(secretId, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    const res = await relayRequest(`/api/transfers/shares/${secretId}`);
    if (res?.ok && res.share?.receiverDeviceId) {
      await startShareSend(res.share);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function fallbackStartSender(secretId) {
  const res = await relayRequest(`/api/transfers/shares/${secretId}/candidates`);
  if (!res?.ok || !Array.isArray(res.candidates)) return;
  const deviceId = getRemoteDeviceId();
  const candidates = res.candidates.filter((c) => c.has_access && c.device_id !== deviceId);
  if (!candidates.length) return;
  const target = candidates[0];
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    relaySocket.send(JSON.stringify({ type: 'start_send', secretId, deviceId: target.device_id }));
  }
}

async function pollShareForCroc(secretId, attempts = 30) {
  for (let i = 0; i < attempts; i += 1) {
    const res = await relayRequest(`/api/transfers/shares/${secretId}`);
    if (res?.ok && res.share?.crocCode) {
      await startShareReceive(res.share);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function handleShareLink(secretId) {
  if (!secretId) return;
  const receiverDeviceId = getRemoteDeviceId();
  const readyRes = await relayRequest(`/api/transfers/shares/${secretId}/ready`, {
    method: 'POST',
    body: { receiverDeviceId }
  });
  if (readyRes?.share) {
    broadcastShareEvent({ type: 'share_ready', share: readyRes.share });
    if (readyRes.share.crocCode) {
      await startShareReceive(readyRes.share);
    } else {
      if (USE_SHARE_SECRET_AS_CROC_CODE) {
        // Wait briefly for sender to start before receiving to avoid "room not ready".
        const waitForSender = async (attempts = 10) => {
          for (let i = 0; i < attempts; i += 1) {
            const res = await relayRequest(`/api/transfers/shares/${secretId}`);
            if (res?.ok && res.share && res.share.status && res.share.status !== 'open') {
              return res.share;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
          return readyRes.share;
        };
        const share = await waitForSender();
        await startShareReceive(share);
      } else {
        pollShareForCroc(secretId).catch(() => {});
      }
    }
  }
}

function parseShareSecretFromLink(urlOrCode) {
  if (!urlOrCode) return null;
  const value = String(urlOrCode).trim();
  const match = value.match(/share\/(\w+)/i) || value.match(/\/s\/(\w+)/i) || value.match(/^m24:\/\/(?:share\/)?(\w+)/i);
  if (match) return match[1];
  if (/^[a-f0-9]{16,}$/i.test(value)) return value;
  return null;
}

function handleIncomingLink(url) {
  const secret = parseShareSecretFromLink(url);
  if (secret) {
    handleShareLink(secret).catch(() => {});
  }
}

function connectRelaySocket() {
  const token = getRelayToken();
  if (!token || !RELAY_WS_URL) return;
  if (relaySocket && (relaySocket.readyState === WebSocket.OPEN || relaySocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  relaySocket = new WebSocket(RELAY_WS_URL);

  relaySocket.on('open', () => {
    const deviceId = getRemoteDeviceId();
    relaySocket.send(JSON.stringify({
      type: 'register',
      token,
      deviceId,
      name: getRelayDeviceName()
    }));

    if (relayHeartbeat) clearInterval(relayHeartbeat);
    relayHeartbeat = setInterval(() => {
      try {
        relaySocket.send(JSON.stringify({
          type: 'heartbeat',
          token,
          deviceId
        }));
      } catch {}
    }, 15000);
  });

  relaySocket.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg?.type) return;
    if (msg.type === 'share_receiver_ready' && msg.share) {
      console.log('[transfer] receiver ready', { secretId: msg.share.secretId });
      broadcastShareEvent({ type: 'share_receiver_ready', share: msg.share });
      startShareSend(msg.share).catch(() => {});
    }
    if (msg.type === 'candidate_check') {
      const secretId = String(msg.secretId || '').trim();
      if (!secretId) return;
      const { hasAccess } = await checkShareAccess(secretId);
      await postCandidate(secretId, hasAccess, hasAccess ? 5 : 0);
    }
    if (msg.type === 'start_send') {
      const secretId = String(msg.secretId || '').trim();
      if (!secretId) return;
      const shareRes = await relayRequest(`/api/transfers/shares/${secretId}`);
      if (shareRes?.ok && shareRes.share) {
        startShareSend(shareRes.share).catch(() => {});
      }
    }
    if (msg.type === 'share_croc_ready' && msg.share) {
      console.log('[transfer] croc ready', { secretId: msg.share.secretId });
      broadcastShareEvent({ type: 'share_croc_ready', share: msg.share });
      startShareReceive(msg.share).catch(() => {});
    }
    if (msg.type === 'share_status' && msg.share) {
      console.log('[transfer] status', { secretId: msg.share.secretId, status: msg.share.status });
      broadcastShareEvent({ type: 'share_status', share: msg.share });
    }
    if (msg.type === 'share_created' && msg.share) {
      console.log('[transfer] share created', { secretId: msg.share.secretId });
      broadcastShareEvent({ type: 'share_created', share: msg.share });
    }
  });

  const scheduleReconnect = () => {
    if (relayReconnectTimer) return;
    relayReconnectTimer = setTimeout(() => {
      relayReconnectTimer = null;
      connectRelaySocket();
    }, 5000);
  };

  relaySocket.on('close', () => {
    if (relayHeartbeat) clearInterval(relayHeartbeat);
    relayHeartbeat = null;
    scheduleReconnect();
  });

  relaySocket.on('error', () => {
    scheduleReconnect();
  });
}

function createWindow() {
  const startMinimized = shouldStartMinimized();
  mainWindow = new BrowserWindow({
  width: 1600,
  height: 900,
  backgroundColor: '#121212',
  show: !startMinimized,
  skipTaskbar: startMinimized,
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
      updateDockVisibility();
    }
  });

  mainWindow.on('show', () => {
    mainWindow.setSkipTaskbar(false);
    updateDockVisibility();
  });

  mainWindow.on('hide', () => {
    mainWindow.setSkipTaskbar(true);
    updateDockVisibility();
  });

  mainWindow.on('closed', () => {
    updateDockVisibility();
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

  if (!app.isDefaultProtocolClient('m24')) {
    try { app.setAsDefaultProtocolClient('m24'); } catch {}
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (app.isReady()) {
      handleIncomingLink(url);
    } else {
      pendingDeepLinks.push(url);
    }
  });

  if (AUTO_LAUNCH && app.setLoginItemSettings) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    console.log('[app] auto-launch enabled');
  }

  setupUpdater();
  createAppMenu();
  createWindow();

  ensureTray();
  connectRelaySocket();
  setInterval(connectRelaySocket, 30000).unref();
  updateDockVisibility();

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
    updateDockVisibility();
  });

  if (pendingDeepLinks.length) {
    pendingDeepLinks.splice(0).forEach((link) => handleIncomingLink(link));
  }

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

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});

ipcMain.handle('croc:send', async (_evt, payload = {}) => {
  try {
    const { paths = [], code, relay, passphrase, yes = true, overwrite = false } = payload || {};
    if (!paths.length) return { ok: false, error: 'No paths provided.' };
    const relayDefault = getCrocRelaySetting();
    const passDefault = getCrocPassphraseSetting();
    const transfer = startCrocProcess({
      direction: 'send',
      paths,
      code,
      relay: relay || relayDefault || undefined,
      passphrase: passphrase || passDefault || undefined,
      yes,
      overwrite
    });
    return { ok: true, transfer };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('croc:receive', async (_evt, payload = {}) => {
  try {
    const { code, dest, relay, passphrase, yes = true, overwrite = false } = payload || {};
    if (!code) return { ok: false, error: 'Missing code.' };
    const relayDefault = getCrocRelaySetting();
    const passDefault = getCrocPassphraseSetting();
    const transfer = startCrocProcess({
      direction: 'receive',
      code,
      dest,
      relay: relay || relayDefault || undefined,
      passphrase: passphrase || passDefault || undefined,
      yes,
      overwrite
    });
    return { ok: true, transfer };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('croc:list', async () => {
  return {
    ok: true,
    transfers: Array.from(crocTransfers.values()),
    logs: crocLogs
  };
});

ipcMain.handle('transfer:status', async () => {
  const relay = await checkRelayHealth();
  const croc = await checkCrocRelay();
  return { ok: true, relay, croc };
});

ipcMain.handle('croc:cancel', async (_evt, id) => {
  const transfer = crocTransfers.get(id);
  if (!transfer || !transfer.pid) return { ok: false, error: 'Transfer not found.' };
  try {
    updateCrocTransfer(id, { cancelled: true });
    process.kill(transfer.pid, 'SIGTERM');
    updateCrocTransfer(id, { status: 'cancelled' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('transfer:shareCreate', async (_evt, payload = {}) => {
  try {
    connectRelaySocket();
    const { paths = [], label, maxDownloads = 0, allowBrowser = false } = payload || {};
    if (!paths.length) return { ok: false, error: 'No files selected.' };
    const ownerDeviceId = getRemoteDeviceId();
    const ownerName = getRelayDeviceName();
    const summary = await getPathsSummary(paths);
    const res = await relayRequest('/api/transfers/shares', {
      method: 'POST',
      body: {
        ownerDeviceId,
        ownerName,
        label,
        maxDownloads,
        allowBrowser,
        totalBytes: summary.totalBytes || 0,
        fileCount: summary.fileCount || 0,
        displayName: summary.displayName || null
      }
    });
    if (!res?.ok || !res.share) return { ok: false, error: res?.error || 'share_create_failed' };
    const pending = { paths, label, maxDownloads, allowBrowser, createdAt: Date.now() };
    sharePendingBySecret.set(res.share.secretId, pending);
    savePendingShare(res.share.secretId, pending);
    broadcastShareEvent({ type: 'share_created', share: res.share });
    // Wait for receiver readiness before starting sender.
    pollShareForReceiver(res.share.secretId).catch(() => {});
    // Ask all devices to report whether they can serve as a sender fallback.
    startCandidateCheck(res.share.secretId);
    return { ok: true, share: res.share };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('transfer:shareList', async (_evt, payload = {}) => {
  try {
    const { ownerDeviceId, status } = payload || {};
    const query = new URLSearchParams();
    if (ownerDeviceId) query.set('ownerDeviceId', ownerDeviceId);
    if (status) query.set('status', status);
    const res = await relayRequest(`/api/transfers/shares?${query.toString()}`);
    return res?.ok ? res : { ok: false, error: res?.error || 'share_list_failed' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('transfer:shareReady', async (_evt, payload = {}) => {
  try {
    connectRelaySocket();
    const secretId = parseShareSecretFromLink(payload?.secretId || payload?.link);
    if (!secretId) return { ok: false, error: 'invalid_share' };
    const shareRes = await relayRequest(`/api/transfers/shares/${secretId}`);
    if (shareRes?.ok && shareRes.share) {
      const pending = loadPendingShare(secretId);
      if (pending) {
        sharePendingBySecret.set(secretId, pending);
      }
    }
    await handleShareLink(secretId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('transfer:shareCancel', async (_evt, payload = {}) => {
  try {
    const secretId = parseShareSecretFromLink(payload?.secretId);
    if (!secretId) return { ok: false, error: 'invalid_share' };
    const res = await relayRequest(`/api/transfers/shares/${secretId}/status`, {
      method: 'POST',
      body: { status: 'cancelled' }
    });
    if (res?.ok && res.share) {
      broadcastShareEvent({ type: 'share_status', share: res.share });
    }
    return res?.ok ? res : { ok: false, error: res?.error || 'share_cancel_failed' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
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
    isQuitting = true;
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
