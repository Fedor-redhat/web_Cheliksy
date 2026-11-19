const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  listMusic: () => ipcRenderer.invoke('music:list'),
  pickMusicFolder: () => ipcRenderer.invoke('music:choose'),
  musicPath: () => ipcRenderer.invoke('music:path'),
  openMusicFolder: () => ipcRenderer.invoke('music:open'),
  saveLyrics: (name, text) => ipcRenderer.invoke('lyrics:save', { name, text }),
  getSystemStats: () => ipcRenderer.invoke('sys:stats'),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:maximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  openMenu: (x, y) => ipcRenderer.invoke('app:menu', { x, y }),
  onMaximized: cb => ipcRenderer.on('win:maximized', (_e, value) => cb(value))
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop');
});
