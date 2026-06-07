// server/index.js — SafeTube Bridge (VPS fix pack)
//
//   (1) yt-dlp bgutil POT plugin — per-video tokens via youtubepot-bgutilhttp
//   (2) Manual fallback: video-bound PO tokens from POT HTTP provider (no env PO pair)
//   (3) Express listens on 0.0.0.0
//   (4) Default client chain: web_embedded → tv → web_safari

'use strict';

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const potClient = require('./pot-client');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp.exe';
const YT_DLP_FORMAT = process.env.YT_DLP_FORMAT || 'best[height<=720][ext=mp4]/best[ext=mp4]/best';
const COOKIES_FILE = process.env.COOKIES_FILE || '';
const PROXY_URL = process.env.PROXY_URL || '';

const YT_DLP_BGUTIL_POT_BASE_URL = (() => {
  const raw =
    process.env.YT_DLP_BGUTIL_POT_BASE_URL ??
    process.env.POT_URL ??
    process.env.POT_PROVIDER_URL;
  if (raw === undefined || raw === null) return 'http://127.0.0.1:4416';
  const t = String(raw).trim();
  if (!t || /^(0|off|false|none)$/i.test(t)) return '';
  return t.replace(/\/$/, '');
})();

const CLIENT_CHAIN = (process.env.YT_CLIENT_CHAIN || 'web_embedded,tv,web_safari').split(',');

const DEFAULT_ANDROID_YOUTUBE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
const YT_DLP_USER_AGENT = (process.env.YT_DLP_USER_AGENT || '').trim() || DEFAULT_ANDROID_YOUTUBE_UA;

const YT_DLP_CLIENT_CERT = (process.env.YT_DLP_CLIENT_CERT || '').trim();
const YT_DLP_CLIENT_KEY = (process.env.YT_DLP_CLIENT_KEY || '').trim();

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}  from=${req.ip}`);
  next();
});

function resolveBridgePath(p) {
  if (!p) return '';
  return path.isAbsolute(p) ? p : path.join(__dirname, p);
}

function resolvePluginDirs() {
  const dirs = [];
  const bundled = path.join(__dirname, 'yt-dlp-plugins');
  if (fs.existsSync(bundled)) dirs.push(bundled);
  const extra = (process.env.YT_DLP_PLUGIN_DIRS || '').trim();
  if (extra) {
    for (const seg of extra.split(/[;,]/)) {
      const d = seg.trim();
      if (!d) continue;
      const resolved = path.isAbsolute(d) ? d : path.join(__dirname, d);
      if (fs.existsSync(resolved)) dirs.push(resolved);
    }
  }
  return dirs;
}

function shouldUsePotPlugin() {
  const override = String(process.env.YT_DLP_USE_POT_PLUGIN || '').trim();
  if (/^(0|off|false|none)$/i.test(override)) return false;
  if (!YT_DLP_BGUTIL_POT_BASE_URL) return false;
  return resolvePluginDirs().length > 0;
}

function buildYtDlpPluginPotArgs() {
  const out = [];
  for (const d of resolvePluginDirs()) out.push('--plugin-dirs', d);
  out.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${YT_DLP_BGUTIL_POT_BASE_URL}`);
  return out;
}

function buildYtDlpArgs({ videoId, client, poToken, visitorData, jsonOnly, usePlugin }) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificates',
    '--no-cookies',
    '-f',
    YT_DLP_FORMAT,
  ];

  if (usePlugin) {
    args.push(...buildYtDlpPluginPotArgs());
    args.push('--extractor-args', `youtube:player_client=${client}`);
  } else if (poToken && visitorData) {
    args.push(
      '--extractor-args',
      `youtube:player_client=${client};po_token=${client}.gvs+${poToken};visitor_data=${visitorData}`
    );
  } else {
    args.push('--extractor-args', `youtube:player_client=${client}`);
  }

  args.push('--user-agent', YT_DLP_USER_AGENT, '--add-header', 'Accept-Language:en-US,en;q=0.9');

  const cert = resolveBridgePath(YT_DLP_CLIENT_CERT);
  const key = resolveBridgePath(YT_DLP_CLIENT_KEY);
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
    args.push('--client-certificate', cert, '--client-key', key);
  }

  const cookiesPath = COOKIES_FILE ? resolveBridgePath(COOKIES_FILE) : '';
  if (cookiesPath && fs.existsSync(cookiesPath)) args.push('--cookies', cookiesPath);
  if (PROXY_URL) args.push('--proxy', PROXY_URL);

  if (jsonOnly) args.push('--dump-single-json', '--skip-download');
  else args.push('--get-url');

  args.push(`https://www.youtube.com/watch?v=${videoId}`);
  return args;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(YT_DLP_PATH, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', (d) => (stdout += d));
    ps.stderr.on('data', (d) => (stderr += d));
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (code === 0) return resolve({ stdout: stdout.trim(), stderr });
      const err = new Error(`yt-dlp exited ${code}: ${stderr.trim() || stdout.trim()}`);
      err.stderr = stderr;
      err.stdout = stdout;
      err.code = code;
      reject(err);
    });
  });
}

async function resolveVideo(videoId, { jsonOnly = false } = {}) {
  let lastErr;
  const usePlugin = shouldUsePotPlugin();

  for (let attempt = 0; attempt < 2; attempt++) {
    let poToken = null;
    let visitorData = null;

    if (!usePlugin) {
      ({ poToken, visitorData } = await potClient.getCredentials({ videoId, force: attempt > 0 }));
    } else if (attempt > 0) {
      await potClient.invalidateCaches().catch(() => {});
    }

    for (const client of CLIENT_CHAIN) {
      const args = buildYtDlpArgs({
        videoId,
        client: String(client).trim(),
        poToken,
        visitorData,
        jsonOnly,
        usePlugin,
      });
      try {
        const { stdout } = await runYtDlp(args);
        return { client: String(client).trim(), output: stdout };
      } catch (err) {
        lastErr = err;
        const s = (err.stderr || '') + (err.message || '');
        const challenged =
          /Sign in to confirm.*not a bot/i.test(s) ||
          /confirm you'?re not a robot/i.test(s) ||
          /requires authentication/i.test(s) ||
          /HTTP Error 403/i.test(s);
        console.warn(`[ytdlp] client=${client} attempt=${attempt} failed: ${err.message.split('\n')[0]}`);
        if (!challenged) break;
      }
    }
  }
  throw lastErr || new Error('resolveVideo: unknown failure');
}

function readLiveMetaFromInfo(info) {
  const liveStatus = info.live_status || (info.is_upcoming ? 'is_upcoming' : info.is_live ? 'is_live' : 'not_live');
  const isUpcoming = Boolean(info.is_upcoming) || liveStatus === 'is_upcoming';
  const isLive = Boolean(info.is_live) || liveStatus === 'is_live';
  return { liveStatus, isUpcoming, isLive };
}

async function resolveLiveMeta(videoId) {
  const { output } = await resolveVideo(videoId, { jsonOnly: true });
  const info = JSON.parse(output);
  return readLiveMetaFromInfo(info);
}

app.get('/health', async (_req, res) => {
  const potUp = await potClient.ping();
  res.json({
    ok: true,
    bridge: { port: PORT, host: HOST },
    pot: {
      url: YT_DLP_BGUTIL_POT_BASE_URL || potClient.POT_BASE_URL,
      reachable: potUp,
      pluginMode: shouldUsePotPlugin(),
      pluginDirs: resolvePluginDirs(),
    },
    ytDlp: YT_DLP_PATH,
    clientChain: CLIENT_CHAIN,
  });
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const liveMeta = await resolveLiveMeta(videoId);
    if (liveMeta.isUpcoming || liveMeta.liveStatus === 'is_upcoming') {
      return res.status(422).json({
        error: 'LIVE_UPCOMING',
        live_status: liveMeta.liveStatus,
        detail: 'This live broadcast has not started yet.',
      });
    }
    const { client, output } = await resolveVideo(videoId, { jsonOnly: false });
    const url = output.split('\n').filter(Boolean).pop();
    res.json({ videoId, client, url, live_status: liveMeta.liveStatus, is_live: liveMeta.isLive });
  } catch (err) {
    console.error('[/api/stream] failed:', err.message);
    const detail = err.message.split('\n').slice(0, 3);
    if (/live|premiere|upcoming|not yet started|scheduled/i.test(err.message)) {
      return res.status(422).json({ error: 'LIVE_UPCOMING', detail });
    }
    res.status(502).json({ error: 'resolve_failed', detail });
  }
});

app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const { client, output } = await resolveVideo(videoId, { jsonOnly: true });
    const info = JSON.parse(output);
    const liveMeta = readLiveMetaFromInfo(info);
    res.json({
      videoId,
      client,
      title: info.title,
      duration: info.duration,
      uploader: info.uploader,
      channel_id: info.channel_id,
      thumbnail: info.thumbnail,
      live_status: liveMeta.liveStatus,
      is_live: liveMeta.isLive,
      is_upcoming: liveMeta.isUpcoming,
      formats: (info.formats || [])
        .filter((f) => f.url)
        .map((f) => ({
          format_id: f.format_id,
          ext: f.ext,
          height: f.height,
          fps: f.fps,
          vcodec: f.vcodec,
          acodec: f.acodec,
          url: f.url,
        })),
    });
  } catch (err) {
    console.error('[/api/info] failed:', err.message);
    res.status(502).json({ error: 'resolve_failed', detail: err.message.split('\n').slice(0, 3) });
  }
});

app.post('/admin/refresh-pot', async (req, res) => {
  potClient.clearCache();
  try {
    await potClient.invalidateCaches();
    const videoId =
      typeof req.body?.videoId === 'string' && /^[\w-]{11}$/.test(req.body.videoId)
        ? req.body.videoId
        : 'dQw4w9WgXcQ';
    const creds = await potClient.getCredentials({ videoId, force: true });
    res.json({
      ok: true,
      videoId,
      pluginMode: shouldUsePotPlugin(),
      visitorData: creds.visitorData.slice(0, 16) + '…',
      poToken: creds.poToken.slice(0, 16) + '…',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, HOST, async () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] POT provider: ${YT_DLP_BGUTIL_POT_BASE_URL || potClient.POT_BASE_URL}`);
  if (shouldUsePotPlugin()) {
    console.log(`[bridge] yt-dlp POT plugin: youtubepot-bgutilhttp base_url=${YT_DLP_BGUTIL_POT_BASE_URL}`);
    console.log(`[bridge] plugin dirs: ${resolvePluginDirs().join(', ')}`);
  } else {
    console.warn('[bridge] POT plugin unavailable — per-video manual POT fallback active');
  }

  const potUp = await potClient.ping();
  if (!potUp) {
    console.error('[bridge] WARNING: POT provider unreachable.');
  } else if (!shouldUsePotPlugin()) {
    try {
      await potClient.getCredentials({ videoId: 'dQw4w9WgXcQ' });
      console.log('[bridge] POT manual fallback warmed up.');
    } catch (err) {
      console.error('[bridge] initial POT warmup failed:', err.message);
    }
  }
});
