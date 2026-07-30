'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes the on-device resolver to the React app as `window.safetube`.
 * The renderer stays sandboxed (contextIsolation on, no Node) — it can only call the
 * one resolve method, which runs in the main process from the device's residential IP.
 */
contextBridge.exposeInMainWorld('safetube', {
  platform: 'electron',
  resolve: (videoId, quality) => ipcRenderer.invoke('safetube:resolve', videoId, quality),
});
