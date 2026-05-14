// server/index.js — SafeTube Bridge
//
// Fixes addressed in this version:
//   (1) Every yt-dlp call carries po_token + visitor_data via --extractor-args,
//       fetched from the local bgutil POT provider (http://127.0.0.1:4416).
//   (2) Credentials are auto-refreshed (TTL cache) and forcibly re-minted on
//       'Sign in to confirm you're not a bot' errors.
//   (3) Express listens on 0.0.0.0:3001 so 176.9.82.81 / www.box.co.il can
//       reach it from outside the VPS.
//   (4) Default yt-dlp client is web_embedded (most challenge-resistant for
//       embedded playback); tv is offered as a fallback chain.

'use strict';

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const potClient = require('./pot-client.cjs');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';                  // fix #3
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp.exe';
const YT_DLP_FORMAT = process.env.YT_DLP_FORMAT || 'best[height<=720][ext=mp4]/best[ext=mp4]/best';
const COOKIES_FILE = process.env.COOKIES_FILE || '';         // optional /path/to/cookies.txt
const PROXY_URL = process.env.PROXY_URL || '';               // optional http://user:pass@host:port
// Ordered fallback chain — first client wins, but if YT challenges we'll retry the next.
const CLIENT_CHAIN = (process.env.YT_CLIENT_CHAIN || 'web_embedded,tv,web_safari').split(',');

// ─── App setup ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Simple request log so we can see who's hitting the bridge.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}  from=${req.ip}`);
  next();
});

// ─── yt-dlp invocation ───────────────────────────────────────────────────────

/**
 * Build the yt-dlp argv for a given videoId + client, injecting POT creds.
 */
function buildYtDlpArgs({ videoId, client, poToken, visitorData, jsonOnly }) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificates',
    '-f', YT_DLP_FORMAT,
    // (1) + (2) + (4): pass POT creds and pin the client used.
    '--extractor-args',
    `youtube:player_client=${client};po_token=${client}.gvs+${poToken};visitor_data=${visitorData}`,
    // Stable, non-suspicious UA.
    '--user-agent',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language:en-US,en;q=0.9',
  ];

  if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
    args.push('--cookies', COOKIES_FILE);
  }
  if (PROXY_URL) {
    args.push('--proxy', PROXY_URL);
  }
  if (jsonOnly) {
    args.push('--dump-single-json', '--skip-download');
  } else {
    args.push('--get-url'); // direct media URL for the frontend to stream
  }
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

/**
 * High-level resolver: tries each client in CLIENT_CHAIN, refreshing POT on
 * 'not a bot' style errors.
 */
async function resolveVideo(videoId, { jsonOnly = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { poToken, visitorData } = await potClient.getCredentials({
      force: attempt > 0,
    });
    for (const client of CLIENT_CHAIN) {
      const args = buildYtDlpArgs({ videoId, client, poToken, visitorData, jsonOnly });
      try {
        const { stdout } = await runYtDlp(args);
        return { client, output: stdout };
      } catch (err) {
        lastErr = err;
        const s = (err.stderr || '') + (err.message || '');
        const challenged =
          /Sign in to confirm.*not a bot/i.test(s) ||
          /confirm you'?re not a robot/i.test(s) ||
          /requires authentication/i.test(s) ||
          /HTTP Error 403/i.test(s);
        console.warn(`[ytdlp] client=${client} attempt=${attempt} failed: ${err.message.split('\n')[0]}`);
        if (!challenged) break; // non-challenge error → try next client only if we still have one
      }
    }
  }
  throw lastErr || new Error('resolveVideo: unknown failure');
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const potUp = await potClient.ping();
  res.json({
    ok: true,
    bridge: { port: PORT, host: HOST },
    pot: { url: potClient.POT_BASE_URL, reachable: potUp },
    ytDlp: YT_DLP_PATH,
    clientChain: CLIENT_CHAIN,
  });
});

// Returns a direct, playable media URL for the given videoId.
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const { client, output } = await resolveVideo(videoId, { jsonOnly: false });
    const url = output.split('\n').filter(Boolean).pop();
    res.json({ videoId, client, url });
  } catch (err) {
    console.error('[/api/stream] failed:', err.message);
    res.status(502).json({ error: 'resolve_failed', detail: err.message.split('\n').slice(0, 3) });
  }
});

// Full metadata (title, duration, thumbnails, formats).
app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const { client, output } = await resolveVideo(videoId, { jsonOnly: true });
    const info = JSON.parse(output);
    res.json({
      videoId,
      client,
      title: info.title,
      duration: info.duration,
      uploader: info.uploader,
      channel_id: info.channel_id,
      thumbnail: info.thumbnail,
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

// Manual cache flush — useful for ops.
app.post('/admin/refresh-pot', async (_req, res) => {
  potClient.clearCache();
  try {
    const creds = await potClient.getCredentials({ force: true });
    res.json({
      ok: true,
      visitorData: creds.visitorData.slice(0, 16) + '…',
      poToken: creds.poToken.slice(0, 16) + '…',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
app.listen(PORT, HOST, async () => {                            // fix #3
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] POT provider: ${potClient.POT_BASE_URL}`);
  const potUp = await potClient.ping();
  if (!potUp) {
    console.error('[bridge] WARNING: POT provider unreachable. ' +
      'Check that the SafeTubeBgutilPot service is running on 4416.');
  } else {
    try {
      await potClient.getCredentials();
      console.log('[bridge] POT credentials warmed up.');
    } catch (err) {
      console.error('[bridge] initial POT warmup failed:', err.message);
    }
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err));
