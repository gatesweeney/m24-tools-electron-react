// indexer/worker/remoteApi.js
const { getSetting } = require('./db/settingsDb');

const REMOTE_API_URL = process.env.M24_REMOTE_API_URL || 'https://api1.motiontwofour.com';

async function remoteRequest(pathname, { method = 'GET', body } = {}) {
  if (!REMOTE_API_URL) return { ok: false, error: 'remote_disabled' };
  const url = `${REMOTE_API_URL}${pathname}`;
  const headers = {};
  const token = getSetting('remote_api_token') || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  try {
    console.log('[remote-worker] request', { method, url });
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    console.log('[remote-worker] response', { url, status: res.status, ok: json?.ok });
    return json;
  } catch (err) {
    console.log('[remote-worker] request failed', { url, message: err?.message || String(err) });
    return { ok: false, error: 'fetch_failed', message: err?.message || String(err) };
  }
}

function getDeviceId() {
  return getSetting('machine_id') || 'local';
}

async function registerDevice(name) {
  const deviceId = getDeviceId();
  const browseEnabled = getSetting('transfers_browse_enabled') !== '0';
  const browseMode = getSetting('transfers_browse_mode') || 'indexed';
  let browseFolders = [];
  try {
    browseFolders = JSON.parse(getSetting('transfers_browse_folders') || '[]') || [];
  } catch {
    browseFolders = [];
  }
  return remoteRequest('/api/device/register', {
    method: 'POST',
    body: {
      deviceId,
      name,
      browseEnabled,
      browseMode,
      browseFolders
    }
  });
}

async function fetchState(deviceId = getDeviceId()) {
  const id = encodeURIComponent(deviceId);
  return remoteRequest(`/api/state?deviceId=${id}`);
}

async function upsertState({ deviceId = getDeviceId(), volumes = [], manualRoots = [], files = [] } = {}) {
  return remoteRequest('/api/state/upsert', {
    method: 'POST',
    body: { deviceId, volumes, manualRoots, files }
  });
}

module.exports = {
  remoteRequest,
  getDeviceId,
  registerDevice,
  fetchState,
  upsertState
};
