// Safe bridge between the renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexspiro', {
  platform: process.platform,
  saveFile: (opts) => ipcRenderer.invoke('nx:saveFile', opts),
  openFiles: (opts) => ipcRenderer.invoke('nx:openFiles', opts),
});
