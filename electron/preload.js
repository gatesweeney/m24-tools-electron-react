const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: async () => {
    return await ipcRenderer.invoke('dialog:openDirectory');
  },
  startProxyJob: async (config) => {
    return await ipcRenderer.invoke('proxy:start', config);
  },
  onProxyProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('proxy:progress', listener);
    return () => {
      ipcRenderer.removeListener('proxy:progress', listener);
    };
  },

  scanOffshootLogs: async (rootFolder) => {
    return await ipcRenderer.invoke('offshoot:scan', rootFolder);
  },

  openInFinder: async (filePath) => {
    return await ipcRenderer.invoke('fs:showItem', filePath);
  },

  // Indexer / OffShoot stuff (examples)...
  getIndexerState: async () => {
    return await ipcRenderer.invoke('indexer:getState');
  },
  scanIndexerRoot: async (rootPath) => {
    return await ipcRenderer.invoke('indexer:scanNow', rootPath || null);
  },

  // 👇 THIS is the function SearchPage expects:
  searchIndexerFiles: async (query, limit) => {
    return await ipcRenderer.invoke('indexer:searchFiles', query, limit || 200);
  },

  getYtFormats: async (url) => ipcRenderer.invoke('ytdlp:getFormats', url),
  downloadYtFormat: async (payload) => ipcRenderer.invoke('ytdlp:download', payload),
  onYtProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ytdlp:progress', listener);
    return () => ipcRenderer.removeListener('ytdlp:progress', listener);
  },

  chooseYtFolder: async () => ipcRenderer.invoke('yt:chooseFolder'),
runYt: async (payload) => ipcRenderer.invoke('yt:run', payload),
onYtLog: (callback) => {
  const listener = (_event, line) => callback(line);
  ipcRenderer.on('yt:log', listener);
  return () => ipcRenderer.removeListener('yt:log', listener);
},


indexerServiceStatus: async () => ipcRenderer.invoke('indexerService:status'),
indexerServiceInstall: async () => ipcRenderer.invoke('indexerService:install'),
indexerServiceUninstall: async () => ipcRenderer.invoke('indexerService:uninstall'),
indexerServiceRestart: async () => ipcRenderer.invoke('indexerService:restart'),

// Indexer state + settings
getIndexerState: async () => ipcRenderer.invoke('indexer:getState'),

indexerSetVolumeActive: async (volumeUuid, isActive) =>
  ipcRenderer.invoke('indexer:setVolumeActive', volumeUuid, isActive),

indexerSetVolumeInterval: async (volumeUuid, intervalMs) =>
  ipcRenderer.invoke('indexer:setVolumeInterval', volumeUuid, intervalMs),

indexerAddManualRoot: async (rootPath) =>
  ipcRenderer.invoke('indexer:addManualRoot', rootPath),

indexerSetManualRootActive: async (rootId, isActive) =>
  ipcRenderer.invoke('indexer:setManualRootActive', rootId, isActive),

indexerSetManualRootInterval: async (rootId, intervalMs) =>
  ipcRenderer.invoke('indexer:setManualRootInterval', rootId, intervalMs),

indexerRemoveManualRoot: async (rootId) =>
  ipcRenderer.invoke('indexer:removeManualRoot', rootId),

scanIndexerNow: async (target) =>
  ipcRenderer.invoke('indexer:scanNow', target),

scanAllNow: async () => ipcRenderer.invoke('indexer:scanAllNow'),
scanVolumeNow: async (volumeUuid) => ipcRenderer.invoke('indexer:scanVolumeNow', volumeUuid),
scanManualRootNow: async (rootId) => ipcRenderer.invoke('indexer:scanManualRootNow', rootId),

onIndexerProgress: (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('indexer:progress', listener);
  return () => ipcRenderer.removeListener('indexer:progress', listener);
},

getIndexerStatus: async () => ipcRenderer.invoke('indexer:status'),
cancelIndexerAll: async () => ipcRenderer.invoke('indexer:cancelAll'),
cancelIndexerKey: async (key) => ipcRenderer.invoke('indexer:cancelKey', key),

  
});