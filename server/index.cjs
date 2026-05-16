// server/index.js — SafeTube Bridge
//
// Updated fixes:
//   ✓ tv + web_embedded first in CLIENT_CHAIN, then ios / android
//   ✓ Correct po_token injection (without .gvs+)
//   ✓ Better resistance against "Sign in to confirm you're not a bot"
//   ✓ External access enabled on 0.0.0.0
//   ✓ POT auto-refresh (POT_URL on Render, else POT_PROVIDER_URL, else :4416)

'use strict';

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const potClient = require('./pot-client.cjs');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp.exe';

const YT_DLP_FORMAT =
  process.env.YT_DLP_FORMAT ||
  'best[height<=720][ext=mp4]/best[ext=mp4]/best';

const COOKIES_FILE = process.env.COOKIES_FILE || '';
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

// ─── yt-dlp invocation ───────────────────────────────────────────────────────

function buildYtDlpArgs({
  videoId,
  client,
  poToken,
  visitorData,
  jsonOnly,
}) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--no-check-certificates',
    '--no-cookies',

    '-f',
    YT_DLP_FORMAT,

    // FIXED TOKEN INJECTION
    '--extractor-args',
    `youtube:player_client=${client};po_token=${poToken};visitor_data=${visitorData}`,

    '--user-agent',
    YT_DLP_USER_AGENT,

    '--add-header',
    'Accept-Language:en-US,en;q=0.9',
  ];

  const cert = resolveBridgePath(YT_DLP_CLIENT_CERT);
  const key = resolveBridgePath(YT_DLP_CLIENT_KEY);
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
    args.push('--client-certificate', cert, '--client-key', key);
  }

  const cookiesPath = COOKIES_FILE ? resolveBridgePath(COOKIES_FILE) : '';
  if (cookiesPath && fs.existsSync(cookiesPath)) {
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
    clientChain: CLIENT_CHAIN,
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
    const { client, output } =
      await resolveVideo(videoId, {
        jsonOnly: false,
      });

    const url =
      output
        .split('\n')
        .filter(Boolean)
        .pop();

    res.json({
      videoId,
      client,
      url,
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