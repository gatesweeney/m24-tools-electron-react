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

  pathExists: async (filePath) => {
    return await ipcRenderer.invoke('fs:pathExists', filePath);
  },



  searchQuery: async (query, opts) =>
    ipcRenderer.invoke('search:query', query, opts || {}),

  getVolumeInfo: async (volumeUuid, deviceId) =>
    ipcRenderer.invoke('search:getVolumeInfo', volumeUuid, deviceId),

  getMediaInfo: async (filePath) =>
    ipcRenderer.invoke('search:getMediaInfo', filePath),

  generateClipThumbnails: async (filePath, opts) =>
    ipcRenderer.invoke('search:generateClipThumbnails', filePath, opts),
  getWaveformCache: async (filePath) =>
    ipcRenderer.invoke('media:getWaveformCache', filePath),
  setWaveformCache: async (filePath, payload) =>
    ipcRenderer.invoke('media:setWaveformCache', filePath, payload),
  generateWaveformImage: async (filePath, opts) =>
    ipcRenderer.invoke('media:generateWaveformImage', filePath, opts),
  playWithFfplay: async (filePath) =>
    ipcRenderer.invoke('media:playWithFfplay', filePath),
  ensureProxyMp4: async (filePath) =>
    ipcRenderer.invoke('media:ensureProxyMp4', filePath),
  openWithApp: async (appName, filePath) =>
    ipcRenderer.invoke('system:openWithApp', appName, filePath),

  checkForUpdates: async () =>
    ipcRenderer.invoke('updater:check'),
  getUpdateStatus: async () =>
    ipcRenderer.invoke('updater:getStatus'),
  quitAndInstallUpdate: async () =>
    ipcRenderer.invoke('updater:quitAndInstall'),
  onUpdateEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('updater:event', listener);
    return () => ipcRenderer.removeListener('updater:event', listener);
  },
  onShowUpdateDialog: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('ui:showUpdateDialog', listener);
    return () => ipcRenderer.removeListener('ui:showUpdateDialog', listener);
  },

getDirectoryContents: async (volumeUuid, rootPath, dirRelativePath, deviceId) =>
  ipcRenderer.invoke('indexer:getDirectoryContents', volumeUuid, rootPath, dirRelativePath, deviceId),

getDirectoryContentsRecursive: async (volumeUuid, rootPath, dirRelativePath, limit, offset, deviceId) =>
  ipcRenderer.invoke('indexer:getDirectoryContentsRecursive', volumeUuid, rootPath, dirRelativePath, limit, offset, deviceId),

getDirectoryStats: async (volumeUuid, rootPath, dirRelativePath, deviceId) =>
  ipcRenderer.invoke('indexer:getDirectoryStats', volumeUuid, rootPath, dirRelativePath, deviceId),

  generateBatchThumbnails: async (files) =>
    ipcRenderer.invoke('search:generateBatchThumbnails', files),

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

// Indexer state + settings
getIndexerState: async () => ipcRenderer.invoke('indexer:getState'),

indexerSetVolumeActive: async (volumeUuid, isActive) =>
  ipcRenderer.invoke('indexer:setVolumeActive', volumeUuid, isActive),

indexerSetVolumeInterval: async (volumeUuid, intervalMs) =>
  ipcRenderer.invoke('indexer:setVolumeInterval', volumeUuid, intervalMs),

indexerSetVolumeAutoPurge: async (volumeUuid, enabled) =>
  ipcRenderer.invoke('indexer:setVolumeAutoPurge', volumeUuid, enabled),

indexerAddManualRoot: async (rootPath) =>
  ipcRenderer.invoke('indexer:addManualRoot', rootPath),

indexerSetManualRootActive: async (rootId, isActive) =>
  ipcRenderer.invoke('indexer:setManualRootActive', rootId, isActive),

indexerSetManualRootInterval: async (rootId, intervalMs) =>
  ipcRenderer.invoke('indexer:setManualRootInterval', rootId, intervalMs),

indexerSetManualRootAutoPurge: async (rootId, enabled) =>
  ipcRenderer.invoke('indexer:setManualRootAutoPurge', rootId, enabled),

indexerRemoveManualRoot: async (rootId) =>
  ipcRenderer.invoke('indexer:removeManualRoot', rootId),

  // X-button actions for Indexer page
  indexerDisableVolume: async (volumeUuid) =>
    ipcRenderer.invoke('indexer:disableVolume', volumeUuid),

  indexerDisableAndDeleteVolumeData: async (volumeUuid) =>
    ipcRenderer.invoke('indexer:disableAndDeleteVolumeData', volumeUuid),

  indexerDisableManualRoot: async (rootId) =>
    ipcRenderer.invoke('indexer:disableManualRoot', rootId),

  indexerDisableAndDeleteManualRootData: async (rootId) =>
    ipcRenderer.invoke('indexer:disableAndDeleteManualRootData', rootId),

scanIndexerNow: async (target) =>
  ipcRenderer.invoke('indexer:scanNow', target),

  scanAllNow: async () => ipcRenderer.invoke('indexer:scanAllNow'),
  scanAllWithThumbs: async () => ipcRenderer.invoke('indexer:scanAllWithThumbs'),
  scanVolumeWithThumbs: async (volumeUuid) => ipcRenderer.invoke('indexer:scanVolumeWithThumbs', volumeUuid),
  scanManualRootWithThumbs: async (rootId) => ipcRenderer.invoke('indexer:scanManualRootWithThumbs', rootId),
  ejectVolume: async (volumeUuid) => ipcRenderer.invoke('indexer:ejectVolume', volumeUuid),
  normalizeManualRootId: async (rootPath) => ipcRenderer.invoke('indexer:normalizeManualRootId', rootPath),
scanVolumeNow: async (volumeUuid) => ipcRenderer.invoke('indexer:scanVolumeNow', volumeUuid),
scanManualRootNow: async (rootId) => ipcRenderer.invoke('indexer:scanManualRootNow', rootId),
listVolumeFiles: async (volumeUuid, limit) => ipcRenderer.invoke('indexer:listVolumeFiles', volumeUuid, limit),

onIndexerProgress: (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('indexer:progress', listener);
  return () => ipcRenderer.removeListener('indexer:progress', listener);
},

getIndexerStatus: async () => ipcRenderer.invoke('indexer:status'),
cancelIndexerAll: async () => ipcRenderer.invoke('indexer:cancelAll'),
cancelIndexerCurrent: async () => ipcRenderer.invoke('indexer:cancelCurrent'),
cancelIndexerKey: async (key) => ipcRenderer.invoke('indexer:cancelKey', key),

getIndexerSetting: (key) => ipcRenderer.invoke('indexer:getSetting', key),
setIndexerSetting: (key, value) => ipcRenderer.invoke('indexer:setSetting', key, value),

checkFullDiskAccess: () => ipcRenderer.invoke('system:checkFullDiskAccess'),
openFullDiskAccess: () => ipcRenderer.invoke('system:openFullDiskAccess'),
getMountedVolumes: () => ipcRenderer.invoke('system:getMountedVolumes'),
openPath: (filePath) => ipcRenderer.invoke('system:openPath', filePath),

// Whisper transcription
transcribeRequest: async (filePath) => ipcRenderer.invoke('transcribe:request', filePath),
transcribeGetCached: async (filePath) => ipcRenderer.invoke('transcribe:getCached', filePath),
transcribeCheckAvailable: async () => ipcRenderer.invoke('transcribe:checkAvailable'),
onTranscribeProgress: (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('transcribe:progress', listener);
  return () => ipcRenderer.removeListener('transcribe:progress', listener);
},


});
