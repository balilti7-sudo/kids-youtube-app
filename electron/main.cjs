'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// Reuse the exact, proven resolver that powered the Media Bridge — here it runs in the
// desktop app's main process, i.e. from the child's own residential IP. No proxy env is
// set, so it resolves directly (see server/media-proxy.cjs: "no proxy configured").
const youtubeInnertube = require('../server/youtube-innertube.cjs');

/**
 * Dev: point at the running Vite server (ELECTRON_START_URL=http://localhost:5174).
 * Packaged: load the built SPA from dist/.
 */
const START_URL = process.env.ELECTRON_START_URL || null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (START_URL) {
    void win.loadURL(START_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

let poTokenWarmed = false;

ipcMain.handle('safetube:resolve', async (_evt, videoId, quality) => {
  const id = String(videoId || '').trim();
  if (!/^[\w-]{11}$/.test(id)) {
    throw new Error('Invalid YouTube video id');
  }
  const q = String(quality || '360p').trim().toLowerCase();

  // Build the BotGuard/InnerTube session once so the first video isn't slow.
  if (!poTokenWarmed) {
    poTokenWarmed = true;
    try {
      await youtubeInnertube.warmup();
    } catch {
      /* best-effort */
    }
  }

  const resolved = await youtubeInnertube.resolveYoutubeStream(id, q);
  return {
    videoId: id,
    playbackUrl: resolved.playbackUrl,
    mime: resolved.mime,
    format: resolved.format,
    quality: resolved.quality,
  };
});

app.whenReady().then(() => {
  void youtubeInnertube.warmup().catch(() => {});
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
