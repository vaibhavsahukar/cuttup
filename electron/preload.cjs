const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  readSave: () => ipcRenderer.invoke('save:read'),
  writeSave: (d) => ipcRenderer.invoke('save:write', d),
  setFullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  setResolution: (w, h) => ipcRenderer.invoke('win:resolution', w, h),
  quit: () => ipcRenderer.invoke('app:quit'),
});
