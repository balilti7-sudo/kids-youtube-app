// server/index.cjs — SafeTube Media Bridge
// YouTube playback via RapidAPI (no yt-dlp).

'use strict';

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');

const rapidApi = require('./rapidapi-youtube.cjs');
const { searchYouTube } = require('./youtube-search.cjs');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const DEFAULT_ANDROID_YOUTUBE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
const MEDIA_USER_AGENT = (process.env.MEDIA_USER_AGENT || '').trim() || DEFAULT_ANDROID_YOUTUBE_UA;

const app = express();

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

void import('./register-email-routes.mjs')
  .then(({ registerBridgeEmailRoutes }) => registerBridgeEmailRoutes(app))
  .catch((err) => {
    console.warn('[bridge] email routes not registered:', err?.message || err);
  });

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} from=${req.ip}`);
  next();
});

const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MS || 8 * 60 * 1000);
const resolveCache = new Map();

function resolveCacheGet(videoId) {
  const hit = resolveCache.get(videoId);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) resolveCache.delete(videoId);
    return null;
  }
  return hit;
}

function resolveCacheSet(videoId, upstreamUrl, meta = {}) {
  resolveCache.set(videoId, {
    upstreamUrl,
    quality: meta.quality || null,
    mime: meta.mime || 'video/mp4',
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  });
}

async function getCachedUpstreamUrl(videoId) {
  const hit = resolveCache.get(videoId);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const resolved = await rapidApi.resolveVideoDownloadUrl(videoId);
  if (!resolved.url) {
    throw new Error('RapidAPI returned no playable URL');
  }

  resolveCacheSet(videoId, resolved.url, resolved);
  return resolveCacheGet(videoId);
}

function inferStreamMetadata(upstreamUrl, cached = {}) {
  const mime = cached.mime || 'video/mp4';
  const format = /\.m3u8(\?|$)/i.test(upstreamUrl) || /mpegurl/i.test(mime) ? 'hls' : 'direct';
  return {
    format,
    mimeType: mime,
    quality: cached.quality || null,
  };
}

function publicBridgeOrigin(req) {
  const forwardedHost = (req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim();
  const forwardedProto = (req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim();
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
  }

  const configured = (process.env.PUBLIC_BRIDGE_ORIGIN || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  return `http://127.0.0.1:${PORT}`.replace(/\/+$/, '');
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
    return res.status(502).json({ error: 'proxy_failed', detail: err.message });
  }

  const lib = upstream.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': MEDIA_USER_AGENT,
    Accept: '*/*',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const proxyReq = lib.request(
    upstream,
    { method: 'GET', headers },
    (proxyRes) => {
      const status = proxyRes.statusCode || 502;

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
            res.status(502).json({ error: 'proxy_failed', detail: err.message });
          }
          return;
        }
        return proxyUpstreamMedia(req, res, nextUrl, {
          videoId,
          redirectCount: redirectCount + 1,
        });
      }

      if (status >= 400) {
        if (videoId && (status === 403 || status === 404 || status === 410)) {
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
      res.status(502).json({ error: 'proxy_failed', detail: err.message });
    }
  });

  proxyReq.end();
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    bridge: { port: PORT, host: HOST },
    resolver: 'rapidapi',
    rapidApiHost: rapidApi.RAPIDAPI_HOST,
    rapidApiKeyConfigured: Boolean(
      process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_YOUTUBE_KEY
    ),
  });
});

app.get('/api/youtube/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const continuation =
    typeof req.query.continuation === 'string' ? req.query.continuation.trim() : '';

  if (!q && !continuation) {
    return res.status(400).json({
      error: 'missing_query',
      detail: 'Provide q= search text or continuation= from a previous response.',
    });
  }

  if (q.length > 200) {
    return res.status(400).json({
      error: 'query_too_long',
      detail: 'Search query must be 200 characters or fewer.',
    });
  }

  try {
    const result = await searchYouTube(q, continuation || null);
    res.json({
      query: q || null,
      videos: result.videos,
      continuation: result.continuation,
      hasMore: result.hasMore,
      source: 'scrape',
    });
  } catch (err) {
    console.error('[/api/youtube/search] failed:', err?.message || err);
    res.status(502).json({
      error: 'search_failed',
      detail: err?.message || 'YouTube search failed',
    });
  }
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }

  try {
    const cached = await getCachedUpstreamUrl(videoId);
    const { format, mimeType, quality } = inferStreamMetadata(cached.upstreamUrl, cached);
    const origin = publicBridgeOrigin(req);
    const playbackUrl = `${origin}/api/media/${encodeURIComponent(videoId)}`;

    console.log(`[api/stream] ${videoId} rapidapi quality=${quality || 'unknown'}`);

    res.json({
      videoId,
      url: playbackUrl,
      format,
      mimeType,
      quality,
      source: 'rapidapi',
      proxied: true,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[/api/stream] failed:', msg);

    if (/live|premiere|upcoming|not yet started|scheduled|isLiveContent/i.test(msg)) {
      return res.status(422).json({
        error: 'LIVE_UPCOMING',
        detail: msg.split('\n').slice(0, 3).join(' '),
      });
    }

    res.status(502).json({
      error: 'resolve_failed',
      detail: msg.split('\n').slice(0, 3),
    });
  }
});

app.get('/api/media/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
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
    return res.status(400).json({ error: 'invalid videoId' });
  }

  try {
    const info = await rapidApi.getVideoInfo(videoId);
    const thumb =
      Array.isArray(info.thumbnail) && info.thumbnail.length > 0
        ? info.thumbnail[info.thumbnail.length - 1].url
        : null;

    res.json({
      videoId,
      title: info.title,
      duration: info.lengthSeconds ? Number(info.lengthSeconds) : null,
      uploader: info.author || info.ownerChannelName,
      channel_id: info.externalChannelId,
      thumbnail: thumb,
      live_status: info.isLiveContent ? 'is_live' : 'not_live',
      is_live: Boolean(info.liveBroadcastDetails?.isLiveNow),
      is_upcoming: false,
      formats: [],
    });
  } catch (err) {
    console.error('[/api/info] failed:', err.message);
    res.status(502).json({
      error: 'resolve_failed',
      detail: err.message.split('\n').slice(0, 3),
    });
  }
});

app.post('/admin/clear-resolve-cache', (_req, res) => {
  resolveCache.clear();
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] YouTube resolver: RapidAPI (${rapidApi.RAPIDAPI_HOST})`);
  if (!process.env.RAPIDAPI_KEY && !process.env.RAPIDAPI_YOUTUBE_KEY) {
    console.error('[bridge] WARNING: RAPIDAPI_KEY is not set — /api/stream will fail.');
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
