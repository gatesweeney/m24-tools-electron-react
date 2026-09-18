// electron/workerLauncher.js
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { app } = require('electron');
const { getBundledBinDir } = require('./binResolver');

let workerProc = null;

let latestIndexerStatus = null;

function getLatestIndexerStatus() {
  return latestIndexerStatus;
}

const messageListeners = new Set();

function onWorkerMessage(fn) {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

function startIndexerWorker() {
  if (workerProc && !workerProc.killed) return workerProc;

  const { devDir, prodDir } = getBundledBinDir();
  const binDir = app.isPackaged ? prodDir : devDir;

  // Worker entry JS - must use unpacked path in production
  // In dev: <repo>/indexer/worker/main.js
  // In prod: .../app.asar.unpacked/indexer/worker/main.js
  let workerEntry = path.join(__dirname, '..', 'indexer', 'worker', 'main.js');
  if (app.isPackaged && workerEntry.includes('app.asar')) {
    workerEntry = workerEntry.replace('app.asar', 'app.asar.unpacked');
  }

  const remoteApiUrl = 'https://api1.motiontwofour.com';
  const env = {
    ...process.env,
    M24_BIN_DIR: binDir,
    ELECTRON_RUN_AS_NODE: '1',
    M24_WORKER_AUTOSTART: '1',
    M24_MERGE_STATE: '1',
    M24_REMOTE_API_URL: remoteApiUrl
    };

  console.log('[worker] starting indexer worker');
  console.log('[worker] app.isPackaged:', app.isPackaged);
  console.log('[worker] M24_BIN_DIR:', env.M24_BIN_DIR);
  console.log('[worker] workerEntry:', workerEntry);

  // Use the same Node runtime embedded in Electron
  workerProc = spawn(process.execPath, [workerEntry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    workerProc.on('message', (msg) => {
  if (msg?.cmd === 'indexerStatus') {
    latestIndexerStatus = msg.status;
  }
  for (const fn of messageListeners) {
    try { fn(msg); } catch {}
  }
});

  workerProc.stdout.on('data', (d) => console.log('[worker]', d.toString().trimEnd()));
  workerProc.stderr.on('data', (d) => console.error('[worker:err]', d.toString().trimEnd()));

  workerProc.on('exit', (code) => {
    console.log('[worker] exited with code', code);
    workerProc = null;
  });

  return workerProc;
}

function stopIndexerWorker() {
  if (workerProc && !workerProc.killed) {
    try { workerProc.kill('SIGKILL'); } catch {}
  }
  workerProc = null;
}

function sendWorkerMessage(msg) {
  if (!workerProc || workerProc.killed) return false;
  try {
    workerProc.send(msg);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  startIndexerWorker,
  stopIndexerWorker,
  sendWorkerMessage,
  onWorkerMessage,
  getLatestIndexerStatus
};
