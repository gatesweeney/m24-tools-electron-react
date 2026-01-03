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



  
});