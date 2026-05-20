// server/index.js — SafeTube Bridge
//
// Updated fixes:
//   ✓ tv + web_embedded first in CLIENT_CHAIN, then ios / android
//   ✓ Correct po_token injection (without .gvs+)
//   ✓ Better resistance against "Sign in to confirm you're not a bot"
//   ✓ External access enabled on 0.0.0.0
//   ✓ POT auto-refresh (POT_URL on Render, else POT_PROVIDER_URL, else :4416)

'use strict';

const path = require('path');
// Load server/.env when running standalone (NSSM start-bridge.ps1 already injects env).
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');

const potClient = require('./pot-client.cjs');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp.exe';

/**
 * Muxed progressive MP4 only — required for --get-url + HTML5 <video>.
 * Do NOT use bestvideo+bestaudio here: that yields two URLs (or audio-only itag 140
 * on tv client), which the browser cannot decode as a single stream.
 */
const DEFAULT_YT_DLP_FORMAT =
  'best[height<=720][ext=mp4][vcodec!=none][acodec!=none]/' +
  'best[ext=mp4][vcodec!=none][acodec!=none]/' +
  '22/18/' +
  'best[height<=720][ext=mp4]/best[ext=mp4]';

const YT_DLP_FORMAT = process.env.YT_DLP_FORMAT || DEFAULT_YT_DLP_FORMAT;

/** Netscape cookie file for yt-dlp (--cookies). Env: COOKIES_FILE or YT_DLP_COOKIES_FILE; default ./cookies.txt */
const COOKIES_FILE_ENV =
  (process.env.COOKIES_FILE || process.env.YT_DLP_COOKIES_FILE || './cookies.txt').trim();
const PROXY_URL = process.env.PROXY_URL || '';

/** Chrome Mobile on Android — aligns with InnerTube `android` / mobile clients (not desktop Windows). */
const DEFAULT_ANDROID_YOUTUBE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
const YT_DLP_USER_AGENT = (process.env.YT_DLP_USER_AGENT || '').trim() || DEFAULT_ANDROID_YOUTUBE_UA;

/** Optional mTLS for yt-dlp; both files must exist. */
const YT_DLP_CLIENT_CERT = (process.env.YT_DLP_CLIENT_CERT || '').trim();
const YT_DLP_CLIENT_KEY = (process.env.YT_DLP_CLIENT_KEY || '').trim();

// FIXED CLIENT CHAIN
const CLIENT_CHAIN = (
  process.env.YT_CLIENT_CHAIN ||
  'tv,web_embedded,ios,android'
).split(',');

// ─── App setup ───────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: true,
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url} from=${req.ip}`
  );
  next();
});

function resolveBridgePath(p) {
  if (!p) return '';
  return path.isAbsolute(p) ? p : path.join(__dirname, p);
}

/** Resolved absolute path to Netscape cookies.txt, or '' if missing/disabled. */
function resolveCookiesPath() {
  if (!COOKIES_FILE_ENV) return '';
  const resolved = resolveBridgePath(COOKIES_FILE_ENV);
  return fs.existsSync(resolved) ? resolved : '';
}

// ─── yt-dlp invocation ───────────────────────────────────────────────────────

/**
 * --get-url may print multiple lines for DASH; pick a muxed video URL the browser can play.
 */
function pickBrowserPlayableStreamUrl(stdout) {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  const isAudioOnly = (u) =>
    /[?&]itag=140(?:&|$)/.test(u) ||
    /mime=audio/i.test(u) ||
    /acodec=[^&]*&[^&]*vcodec=none/i.test(u);

  const isMuxedVideo = (u) =>
    /mime=video/i.test(u) ||
    (/googlevideo\.com/i.test(u) && !isAudioOnly(u));

  const muxed = lines.find(isMuxedVideo);
  if (muxed) return muxed;

  const notAudio = lines.find((u) => !isAudioOnly(u));
  return notAudio || lines[lines.length - 1];
}

function buildYtDlpArgs({
  videoId,
  client,
  poToken,
  visitorData,
  jsonOnly,
}) {
  const cookiesPath = resolveCookiesPath();

  const args = [
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificates',
  ];

  // Only disable cookies when no Netscape file is configured. Passing both
  // --no-cookies and --cookies can prevent yt-dlp from loading the file.
  if (!cookiesPath) {
    args.push('--no-cookies');
  }

  args.push(
    '-f',
    YT_DLP_FORMAT,

    // FIXED TOKEN INJECTION
    '--extractor-args',
    `youtube:player_client=${client};po_token=${poToken};visitor_data=${visitorData}`,

    '--user-agent',
    YT_DLP_USER_AGENT,

    '--add-header',
    'Accept-Language:en-US,en;q=0.9',
  );

  const cert = resolveBridgePath(YT_DLP_CLIENT_CERT);
  const key = resolveBridgePath(YT_DLP_CLIENT_KEY);
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
    args.push('--client-certificate', cert, '--client-key', key);
  }

  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  if (PROXY_URL) {
    args.push('--proxy', PROXY_URL);
  }

  if (jsonOnly) {
    args.push('--dump-single-json', '--skip-download');
  } else {
    args.push('--get-url');
  }

  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  return args;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn(YT_DLP_PATH, args, {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    ps.stdout.on('data', (d) => {
      stdout += d;
    });

    ps.stderr.on('data', (d) => {
      stderr += d;
    });

    ps.on('error', reject);

    ps.on('close', (code) => {
      if (code === 0) {
        return resolve({
          stdout: stdout.trim(),
          stderr,
        });
      }

      const err = new Error(
        `yt-dlp exited ${code}: ${stderr.trim() || stdout.trim()}`
      );

      err.stderr = stderr;
      err.stdout = stdout;
      err.code = code;

      reject(err);
    });
  });
}

async function resolveVideo(videoId, { jsonOnly = false } = {}) {
  let lastErr;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { poToken, visitorData } =
      await potClient.getCredentials({
        force: attempt > 0,
      });

    for (const client of CLIENT_CHAIN) {
      const args = buildYtDlpArgs({
        videoId,
        client,
        poToken,
        visitorData,
        jsonOnly,
      });

      try {
        const { stdout } = await runYtDlp(args);

        return {
          client,
          output: stdout,
        };
      } catch (err) {
        lastErr = err;

        const s =
          (err.stderr || '') +
          (err.message || '');

        const challenged =
          /Sign in to confirm.*not a bot/i.test(s) ||
          /confirm you'?re not a robot/i.test(s) ||
          /requires authentication/i.test(s) ||
          /HTTP Error 403/i.test(s);

        console.warn(
          `[ytdlp] client=${client} attempt=${attempt} failed: ${
            err.message.split('\n')[0]
          }`
        );

        if (!challenged) {
          break;
        }
      }
    }
  }

  throw lastErr || new Error('resolveVideo: unknown failure');
}

/** Cache googlevideo URLs so `/api/stream` + `/api/media` share one yt-dlp resolve. */
const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MS || 15 * 60 * 1000);
const resolveCache = new Map();

function resolveCacheGet(videoId) {
  const hit = resolveCache.get(videoId);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) resolveCache.delete(videoId);
    return null;
  }
  return hit;
}

function resolveCacheSet(videoId, upstreamUrl, client) {
  resolveCache.set(videoId, {
    upstreamUrl,
    client,
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  });
}

async function getCachedUpstreamUrl(videoId) {
  const hit = resolveCacheGet(videoId);
  if (hit) return hit;

  const { client, output } = await resolveVideo(videoId, { jsonOnly: false });
  const upstreamUrl = pickBrowserPlayableStreamUrl(output);
  if (!upstreamUrl) {
    throw new Error('yt-dlp returned no playable URL');
  }
  resolveCacheSet(videoId, upstreamUrl, client);
  return resolveCacheGet(videoId);
}

function inferStreamMetadata(upstreamUrl) {
  const format = /\.m3u8(\?|$)/i.test(upstreamUrl) ? 'hls' : 'direct';
  let mimeType = 'video/mp4';
  const mimeParam = upstreamUrl.match(/[?&]mime=([^&]+)/i);
  if (mimeParam) {
    try {
      mimeType = decodeURIComponent(mimeParam[1].replace(/\+/g, '%20'));
    } catch {
      mimeType = mimeParam[1];
    }
  } else if (format === 'hls') {
    mimeType = 'application/vnd.apple.mpegurl';
  }

  let quality = null;
  const itag = upstreamUrl.match(/[?&]itag=(\d+)/)?.[1];
  if (itag === '18') quality = '360p';
  else if (itag === '22') quality = '720p';

  return { format, mimeType, quality };
}

function publicBridgeOrigin(req) {
  const configured = (process.env.PUBLIC_BRIDGE_ORIGIN || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const host = req.get('host');
  if (!host) return `http://127.0.0.1:${PORT}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

const MAX_MEDIA_REDIRECTS = 8;

function proxyUpstreamMedia(req, res, upstreamUrl, { videoId, redirectCount = 0 } = {}) {
  if (redirectCount > MAX_MEDIA_REDIRECTS) {
    return res.status(502).json({
      error: 'proxy_failed',
      detail: 'too many redirects from upstream CDN',
    });
  }

  let upstream;
  try {
    upstream = new URL(upstreamUrl);
  } catch (err) {
    return res.status(502).json({
      error: 'proxy_failed',
      detail: err.message,
    });
  }

  const lib = upstream.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': YT_DLP_USER_AGENT,
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const proxyReq = lib.request(
    upstream,
    { method: 'GET', headers },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;

      // googlevideo often 302s to the edge node — <video> cannot follow that itself.
      if (status >= 300 && status < 400) {
        const location = proxyRes.headers.location;
        proxyRes.resume();
        if (!location) {
          if (!res.headersSent) {
            res.status(502).json({
              error: 'proxy_failed',
              detail: `upstream redirect ${status} without Location`,
            });
          }
          return;
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, upstream).href;
        } catch (err) {
          if (!res.headersSent) {
            res.status(502).json({
              error: 'proxy_failed',
              detail: err.message,
            });
          }
          return;
        }
        return proxyUpstreamMedia(req, res, nextUrl, {
          videoId,
          redirectCount: redirectCount + 1,
        });
      }

      if (status >= 400) {
        if (videoId && (status === 403 || status === 410)) {
          resolveCache.delete(videoId);
        }
        if (!res.headersSent) res.status(status);
        proxyRes.resume();
        return res.end();
      }

      res.status(status);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value == null || value === '') continue;
        const lk = key.toLowerCase();
        if (
          lk === 'content-type' ||
          lk === 'content-length' ||
          lk === 'content-range' ||
          lk === 'accept-ranges' ||
          lk === 'cache-control'
        ) {
          res.setHeader(key, value);
        }
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges'
      );
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'video/mp4');
      }
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('[/api/media] proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({
        error: 'proxy_failed',
        detail: err.message,
      });
    }
  });

  proxyReq.end();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const potUp = await potClient.ping();

  res.json({
    ok: true,
    bridge: {
      port: PORT,
      host: HOST,
    },
    pot: {
      url: potClient.POT_BASE_URL,
      reachable: potUp,
    },
    ytDlp: YT_DLP_PATH,
    ytDlpFormat: YT_DLP_FORMAT,
    clientChain: CLIENT_CHAIN,
    cookiesFile: resolveCookiesPath() || null,
  });
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({
      error: 'invalid videoId',
    });
  }

  try {
    const cached = await getCachedUpstreamUrl(videoId);
    const upstreamUrl = cached.upstreamUrl;
    const client = cached.client;

    if (/[?&]itag=140(?:&|$)/.test(upstreamUrl) || /mime=audio/i.test(upstreamUrl)) {
      console.warn(
        `[api/stream] WARNING: URL looks audio-only (itag=140); check YT_DLP_FORMAT — ${upstreamUrl.slice(0, 120)}…`
      );
    } else {
      console.log(
        `[api/stream] ${videoId} client=${client} muxed url (${upstreamUrl.length} chars)`
      );
    }

    const { format, mimeType, quality } = inferStreamMetadata(upstreamUrl);
    const origin = publicBridgeOrigin(req);
    const playbackUrl = `${origin}/api/media/${encodeURIComponent(videoId)}`;

    res.json({
      videoId,
      url: playbackUrl,
      format,
      mimeType,
      quality,
      source: `ytdlp:${client}`,
      proxied: true,
    });
  } catch (err) {
    console.error(
      '[/api/stream] failed:',
      err.message
    );

    res.status(502).json({
      error: 'resolve_failed',
      detail: err.message
        .split('\n')
        .slice(0, 3),
    });
  }
});

/** Proxied progressive MP4 / HLS for `<video src>` — supports Range seeks. */
app.get('/api/media/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({
      error: 'invalid videoId',
    });
  }

  try {
    const cached = await getCachedUpstreamUrl(videoId);
    proxyUpstreamMedia(req, res, cached.upstreamUrl, { videoId });
  } catch (err) {
    console.error('[/api/media] failed:', err.message);
    res.status(502).json({
      error: 'resolve_failed',
      detail: err.message.split('\n').slice(0, 3),
    });
  }
});

app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({
      error: 'invalid videoId',
    });
  }

  try {
    const { client, output } =
      await resolveVideo(videoId, {
        jsonOnly: true,
      });

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
    console.error(
      '[/api/info] failed:',
      err.message
    );

    res.status(502).json({
      error: 'resolve_failed',
      detail: err.message
        .split('\n')
        .slice(0, 3),
    });
  }
});

app.post('/admin/refresh-pot', async (_req, res) => {
  potClient.clearCache();

  try {
    const creds =
      await potClient.getCredentials({
        force: true,
      });

    res.json({
      ok: true,
      visitorData:
        creds.visitorData.slice(0, 16) + '…',

      poToken:
        creds.poToken.slice(0, 16) + '…',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// ─── Boot ────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, async () => {
  console.log(
    `[bridge] listening on http://${HOST}:${PORT}`
  );

  console.log(
    `[bridge] POT provider: ${potClient.POT_BASE_URL}`
  );

  console.log(`[bridge] yt-dlp format: ${YT_DLP_FORMAT}`);

  const cookiesPath = resolveCookiesPath();
  if (cookiesPath) {
    console.log(`[bridge] yt-dlp cookies: ${cookiesPath}`);
  } else {
    console.warn(
      `[bridge] yt-dlp cookies: NOT FOUND (expected ${resolveBridgePath(COOKIES_FILE_ENV)}) — bot challenges likely`
    );
  }

  const potUp = await potClient.ping();

  if (!potUp) {
    console.error(
      '[bridge] WARNING: POT provider unreachable.'
    );
  } else {
    try {
      await potClient.getCredentials();

      console.log(
        '[bridge] POT credentials warmed up.'
      );
    } catch (err) {
      console.error(
        '[bridge] initial POT warmup failed:',
        err.message
      );
    }
  }
});

process.on(
  'unhandledRejection',
  (err) => console.error('[unhandledRejection]', err)
);

process.on(
  'uncaughtException',
  (err) => console.error('[uncaughtException]', err)
);