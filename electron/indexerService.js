// electron/indexerService.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { app } = require('electron');

const PLIST_LABEL = 'com.m24.tools.indexer';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || ''
  };
}

/**
 * Compute paths inside the installed app bundle.
 */
function getPackagedPaths() {
  // In packaged app, process.execPath is:
  // .../M24 Tools.app/Contents/MacOS/M24 Tools
  const execPath = process.execPath;

  // Worker JS is bundled into app.asar
  // We included "indexer/**/*" in build.files, so it should be there.
  // We can refer to it relative to Resources/app.asar.
  const resourcesDir = path.join(path.dirname(execPath), '..', 'Resources');

  const workerEntry = path.join(resourcesDir, 'app.asar', 'indexer', 'worker', 'main.js');

  // Binaries are unpacked to app.asar.unpacked
  const binDir = path.join(resourcesDir, 'app.asar.unpacked', 'electron', 'bin');

  return { execPath, workerEntry, binDir };
}

function ensureLaunchAgentsDir() {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildPlist({ execPath, workerEntry, binDir }) {
  // launchd plist XML (no shell). ProgramArguments runs the executable directly.
  // We use process.execPath (Electron binary) to run the worker JS with embedded Node.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>${workerEntry}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>M24_BIN_DIR</key>
    <string>${binDir}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), 'Library', 'Logs', 'm24-indexer.log')}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), 'Library', 'Logs', 'm24-indexer.err.log')}</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>`;
}

function status() {
  // launchctl list returns 0 if loaded, 1 if not
  const res = run('launchctl', ['list', PLIST_LABEL]);
  const loaded = res.status === 0;
  return {
    ok: true,
    loaded,
    plistPath: PLIST_PATH,
    stdout: res.stdout,
    stderr: res.stderr
  };
}

function install() {
  if (!app.isPackaged) {
    return {
      ok: false,
      error: 'Install is only supported in packaged builds. In dev, the worker runs when the app runs.'
    };
  }

  ensureLaunchAgentsDir();

  const { execPath, workerEntry, binDir } = getPackagedPaths();

  if (!fs.existsSync(workerEntry)) {
    return { ok: false, error: `Worker entry not found: ${workerEntry}` };
  }
  if (!fs.existsSync(binDir)) {
    return { ok: false, error: `Bin dir not found: ${binDir}` };
  }

  const plist = buildPlist({ execPath, workerEntry, binDir });
  fs.writeFileSync(PLIST_PATH, plist, 'utf8');

  // Load it
  const unloadFirst = run('launchctl', ['unload', PLIST_PATH]); // ignore errors
  const load = run('launchctl', ['load', PLIST_PATH]);
  if (load.status !== 0) {
    return { ok: false, error: load.stderr || load.stdout || 'launchctl load failed' };
  }

  return { ok: true, plistPath: PLIST_PATH };
}

function uninstall() {
  // Unload if loaded
  run('launchctl', ['unload', PLIST_PATH]);

  try {
    if (fs.existsSync(PLIST_PATH)) fs.unlinkSync(PLIST_PATH);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  return { ok: true };
}

function restart() {
  // unload/load sequence
  const u = run('launchctl', ['unload', PLIST_PATH]);
  const l = run('launchctl', ['load', PLIST_PATH]);
  if (l.status !== 0) return { ok: false, error: l.stderr || l.stdout || 'restart failed' };
  return { ok: true };
}

module.exports = {
  status,
  install,
  uninstall,
  restart
};