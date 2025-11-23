const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { runProxyJob } = require('./fs-ops');
const { scanOffshootLogs } = require('./offshoot-logs');
const { getIndexerState, scanNow, searchFiles } = require('../indexer/uiApi');

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