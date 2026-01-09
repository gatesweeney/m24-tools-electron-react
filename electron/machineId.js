const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// Get userData path without requiring electron (for worker process compatibility)
function getUserDataPath() {
  // Try to get from electron if available
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {}

  // Fallback: compute path based on platform
  const appName = 'M24 Tools';
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), appName);
  } else {
    return path.join(os.homedir(), '.config', appName.toLowerCase().replace(/\s+/g, '-'));
  }
}

function getMacHardwareId() {
  try {
    const out = execSync(
      `ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformUUID/{print $(NF-1)}'`,
      { encoding: 'utf8' }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function getFileFallbackId() {
  const userDataPath = getUserDataPath();
  const p = path.join(userDataPath, 'fallback.txt');
  try {
    const s = fs.readFileSync(p, 'utf8').trim();
    if (s) return s;
  } catch {}
  const id = crypto.randomUUID();
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(p, id, 'utf8');
  return id;
}

function getStableMachineId() {
  if (process.platform === 'darwin') {
    const hw = getMacHardwareId();
    if (hw) return hw;
  }
  return getFileFallbackId();
}

module.exports = { getStableMachineId };