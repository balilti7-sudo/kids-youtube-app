// server/index.cjs — SafeTube Media Bridge
// YouTube playback: Bunny Stream (fetch + transcode + CDN HLS).

'use strict';

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* dotenv optional */ }

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');

const bunnyStream = require('./bunny-stream.cjs');
const { searchYouTube } = require('./youtube-search.cjs');
const { ensureYtDlpBinary } = require('./ensure-ytdlp.cjs');

const BUNNY_CONFIGURED = bunnyStream.isConfigured();

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const DEFAULT_ANDROID_YOUTUBE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
const MEDIA_USER_AGENT = (process.env.MEDIA_USER_AGENT || '').trim() || DEFAULT_ANDROID_YOUTUBE_UA;
const MEDIA_PROXY_TIMEOUT_MS = Number(process.env.MEDIA_PROXY_TIMEOUT_MS || 90_000);

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
const STREAM_PREPARE_TTL_MS = Number(process.env.STREAM_PREPARE_TTL_MS || 5 * 60 * 1000);
/** When async=1, wait this long for a fast cache hit before returning 202. */
const ASYNC_STREAM_QUICK_READY_MS = Number(process.env.ASYNC_STREAM_QUICK_READY_MS || 2_500);
const resolveCache = new Map();
/** In-flight async stream preparation jobs (keyed by videoId:quality). */
const streamPrepareJobs = new Map();

const ALLOWED_STREAM_QUALITIES = new Set(['240p', '360p', '480p', '720p', '1080p']);

function normalizeStreamQuality(raw, fallback = '360p') {
  const q = String(raw || fallback).trim().toLowerCase();
  return ALLOWED_STREAM_QUALITIES.has(q) ? q : fallback;
}

function resolveCacheKey(videoId, rawQuality, fallback = '360p') {
  const q = normalizeStreamQuality(rawQuality, fallback);
  return `${videoId}:${q}`;
}

function playbackMediaPath(videoId, rawQuality, fallback = '360p') {
  const q = normalizeStreamQuality(rawQuality, fallback);
  return `/api/media/${encodeURIComponent(videoId)}?quality=${encodeURIComponent(q)}`;
}

function buildResolveCacheEntry(upstreamUrl, meta = {}) {
  return {
    upstreamUrl,
    quality: meta.quality || null,
    mime: meta.mime || 'video/mp4',
    source: meta.source || null,
    requestedQuality: meta.requestedQuality || null,
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  };
}

function resolveCacheGet(cacheKey) {
  const hit = resolveCache.get(cacheKey);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) resolveCache.delete(cacheKey);
    return null;
  }
  return hit;
}

/** Look up a cached upstream URL using the same key scheme as /api/stream. */
function lookupResolveCacheEntry(videoId, rawQuality, fallback = '360p') {
  const cacheKey = resolveCacheKey(videoId, rawQuality, fallback);
  const primary = resolveCacheGet(cacheKey);
  if (primary) {
    return { entry: primary, cacheKey, lookup: 'primary' };
  }

  const prefix = `${videoId}:`;
  for (const [key, value] of resolveCache.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (value.expiresAt > Date.now()) {
      return { entry: value, cacheKey: key, lookup: 'alias' };
    }
    resolveCache.delete(key);
  }

  const legacy = resolveCacheGet(videoId);
  if (legacy) {
    return { entry: legacy, cacheKey: videoId, lookup: 'legacy' };
  }

  return { entry: null, cacheKey, lookup: 'miss' };
}

function resolveCacheSet(cacheKey, upstreamUrl, meta = {}) {
  resolveCache.set(cacheKey, buildResolveCacheEntry(upstreamUrl, meta));
}

function buildStreamJsonResponse(req, videoId, rawQuality, cached) {
  const quality = normalizeStreamQuality(rawQuality, '360p');
  const { format, mimeType, quality: resolvedQuality } = inferStreamMetadata(cached.upstreamUrl, cached);
  const useDirectCdn =
    cached.source === 'bunny' ||
    cached.proxied === false ||
    /bunnycdn\.com|b-cdn\.net|mediadelivery\.net/i.test(String(cached.upstreamUrl || ''));

  const origin = publicBridgeOrigin(req);
  const playbackUrl =
    useDirectCdn && cached.upstreamUrl?.startsWith('http')
      ? cached.upstreamUrl
      : `${origin}${playbackMediaPath(videoId, rawQuality, '360p')}`;

  return {
    status: 'ready',
    videoId,
    url: playbackUrl,
    format,
    mimeType,
    quality: resolvedQuality || quality,
    source: cached.source || 'bunny',
    proxied: !useDirectCdn,
  };
}

function streamStatusPollUrl(req, videoId, rawQuality) {
  const q = normalizeStreamQuality(rawQuality, '360p');
  const origin = publicBridgeOrigin(req);
  return `${origin}/api/stream/${encodeURIComponent(videoId)}/status?quality=${encodeURIComponent(q)}`;
}

function isRetryableStreamPrepareError(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (/live|premiere|upcoming|not yet started|scheduled|islivecontent|private|auth failed/i.test(msg)) {
    return false;
  }
  if (/no direct media url|no fetchable media url|missing direct media url|returned no direct/i.test(msg)) {
    return false;
  }
  return (
    err?.fileNotReady ||
    /timeout|timed out|econnaborted|econnreset|etimedout|network|socket hang up|transcoding not finished|fetch queue full|file not ready|not ready after|still processing|preparing|503|502|504|429/i.test(
      msg
    )
  );
}

function classifyStreamResolveError(err) {
  const msg = err?.message || String(err);
  if (/live|premiere|upcoming|not yet started|scheduled|isLiveContent/i.test(msg)) {
    return {
      status: 422,
      body: {
        status: 'failed',
        error: 'LIVE_UPCOMING',
        detail: msg.split('\n').slice(0, 3).join(' '),
      },
    };
  }
  if (
    err?.fileNotReady ||
    /file not ready|not ready after|still processing|transcoding not finished|fetch queue full|timeout|timed out|econnaborted/i.test(
      msg
    )
  ) {
    return {
      status: 503,
      body: {
        status: 'processing',
        error: 'FILE_NOT_READY',
        detail: msg.split('\n').slice(0, 3).join(' '),
        retryAfterSec: 15,
        retryAfterMs: 5000,
      },
    };
  }
  return {
    status: 502,
    body: {
      status: 'failed',
      error: 'resolve_failed',
      detail: msg.split('\n').slice(0, 3),
    },
  };
}

function startStreamPrepare(videoId, rawQuality, { forceRestart = false } = {}) {
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');
  const cached = lookupResolveCacheEntry(videoId, rawQuality, '360p');
  if (cached.entry) {
    return { status: 'ready', cacheKey, cached: cached.entry, promise: null };
  }

  const existing = streamPrepareJobs.get(cacheKey);
  if (existing) {
    if (existing.status === 'processing') {
      existing.expiresAt = Date.now() + STREAM_PREPARE_TTL_MS;
      return existing;
    }
    if (existing.expiresAt > Date.now()) {
      if (
        forceRestart &&
        existing.status === 'failed' &&
        existing.error &&
        isRetryableStreamPrepareError(existing.error)
      ) {
        streamPrepareJobs.delete(cacheKey);
      } else {
        return existing;
      }
    }
  }

  const progress = {
    phase: 'starting',
    activeSource: null,
    fallbackFrom: null,
    detail: 'Starting video resolve',
    durationSeconds: null,
    isLongVideo: null,
    retryAfterMs: 3000,
  };

  const job = {
    status: 'processing',
    cacheKey,
    startedAt: Date.now(),
    expiresAt: Date.now() + STREAM_PREPARE_TTL_MS,
    cached: null,
    error: null,
    promise: null,
    progress,
  };

  job.promise = getCachedUpstreamUrl(videoId, rawQuality, { progress })
    .then((resolved) => {
      job.status = 'ready';
      job.cached = resolved;
      job.error = null;
      return resolved;
    })
    .catch((err) => {
      console.error(
        `[stream-prepare] failed video=${videoId} quality=${rawQuality || '360p'}: ${err?.message || err}`
      );
      job.status = 'failed';
      job.error = err;
      job.cached = null;
      throw err;
    })
    .finally(() => {
      setTimeout(() => {
        const current = streamPrepareJobs.get(cacheKey);
        if (current === job && job.status !== 'processing') {
          streamPrepareJobs.delete(cacheKey);
        }
      }, STREAM_PREPARE_TTL_MS);
    });

  streamPrepareJobs.set(cacheKey, job);
  return job;
}

function buildProcessingStatusResponse(req, videoId, rawQuality, job) {
  const progress = job?.progress || {};
  return {
    status: 'processing',
    videoId,
    retryAfterMs: progress.retryAfterMs || 3000,
    elapsedMs: job ? Date.now() - job.startedAt : 0,
    phase: progress.phase || 'processing',
    activeSource: progress.activeSource || 'bunny',
    fallbackFrom: progress.fallbackFrom || null,
    detail: progress.detail || null,
    durationSeconds: progress.durationSeconds || null,
    encodeProgress: progress.encodeProgress ?? null,
    bunnyGuid: progress.bunnyGuid || null,
    ingestResolver: progress.ingestResolver || null,
    pollUrl: streamStatusPollUrl(req, videoId, rawQuality),
  };
}

/**
 * Resolve via Bunny Stream: yt-dlp ingest → transcode → CDN HLS.
 * @param {object} [progress] — mutable status for async /status polling
 */
async function resolveVideoDownloadUrl(videoId, quality = '360p', progress = null) {
  if (!BUNNY_CONFIGURED) {
    throw new Error(
      'Bunny Stream is not configured (set BUNNY_STREAM_API_KEY and BUNNY_LIBRARY_ID on the Media Bridge)'
    );
  }

  const targetQuality = normalizeStreamQuality(quality);

  if (progress) {
    progress.activeSource = 'bunny';
    progress.phase = progress.phase || 'resolve';
    progress.detail = progress.detail || 'Resolving via Bunny Stream';
    progress.retryAfterMs = progress.retryAfterMs || 3000;
  }

  const resolved = await bunnyStream.resolveVideoDownloadUrl(videoId, targetQuality, progress);
  if (!resolved.url) {
    throw new Error('Bunny Stream returned no playable URL');
  }

  return {
    url: resolved.url,
    quality: resolved.quality || targetQuality,
    mime: resolved.mime || 'application/vnd.apple.mpegurl',
    format: resolved.format || 'hls',
    proxied: false,
    source: 'bunny',
    bunnyGuid: resolved.bunnyGuid || null,
  };
}

async function getVideoInfo(videoId) {
  if (!BUNNY_CONFIGURED) {
    throw new Error('Video info unavailable (Bunny Stream not configured)');
  }
  return bunnyStream.getVideoInfo(videoId);
}

async function getCachedUpstreamUrl(
  videoId,
  rawQuality = '360p',
  { forceRefresh = false, progress = null } = {}
) {
  const targetQuality = normalizeStreamQuality(rawQuality, '360p');
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');

  if (!forceRefresh) {
    const cached = lookupResolveCacheEntry(videoId, rawQuality, '360p');
    if (cached.entry) return cached.entry;
  } else {
    resolveCache.delete(cacheKey);
  }

  try {
    const resolved = await resolveVideoDownloadUrl(videoId, targetQuality, progress);
    if (!resolved?.url) {
      throw new Error(`No playable URL from Bunny Stream for ${videoId}`);
    }

    resolveCacheSet(cacheKey, resolved.url, {
      ...resolved,
      mime: resolved.mime,
      requestedQuality: targetQuality,
    });
    return resolveCache.get(cacheKey);
  } catch (err) {
    console.error(
      `[stream-prepare] getCachedUpstreamUrl failed video=${videoId}: ${err?.message || err}`
    );
    throw err;
  }
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

function proxyUpstreamMedia(req, res, upstreamUrl, proxyOpts = {}) {
  const {
    videoId,
    quality,
    cacheKey,
    source,
    redirectCount = 0,
    retried = false,
    refreshUpstream,
  } = proxyOpts;

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
    { method: 'GET', headers, timeout: MEDIA_PROXY_TIMEOUT_MS },
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
          ...proxyOpts,
          redirectCount: redirectCount + 1,
        });
      }

      if (status >= 400) {
        const staleUpstream = status === 403 || status === 404 || status === 410;
        if (staleUpstream && cacheKey) {
          resolveCache.delete(cacheKey);
        }
        console.error(
          `[/api/media] upstream HTTP ${status} video=${videoId || '?'} quality=${quality || '?'} source=${source || '?'} url=${upstreamUrl.slice(0, 96)}…`
        );

        if (
          staleUpstream &&
          !retried &&
          typeof refreshUpstream === 'function' &&
          !res.headersSent
        ) {
          proxyRes.resume();
          return sleepMs(0)
            .then(() => refreshUpstream())
            .then((freshUrl) => {
              if (!freshUrl || res.headersSent) return;
              console.log(
                `[/api/media] retry after stale upstream video=${videoId || '?'} quality=${quality || '?'} source=${source || '?'}`
              );
              proxyUpstreamMedia(req, res, freshUrl, { ...proxyOpts, retried: true });
            })
            .catch((err) => {
              console.error('[/api/media] refresh after stale upstream failed:', err.message);
              if (!res.headersSent) {
                if (source === 'bunny' && status === 404) {
                  res.status(503).json({
                    error: 'FILE_NOT_READY',
                    detail: err.message.split('\n').slice(0, 2).join(' '),
                    retryAfterSec: 15,
                  });
                } else {
                  res.status(status);
                  res.end();
                }
              }
            });
        }

        if (!res.headersSent) {
          if (staleUpstream && source === 'bunny' && status === 404) {
            res.status(503).json({
              error: 'FILE_NOT_READY',
              detail: 'Upstream CDN file not ready yet (large video may still be processing)',
              retryAfterSec: 15,
            });
          } else {
            res.status(status);
            res.end();
          }
        }
        proxyRes.resume();
        return;
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

      proxyRes.on('error', (err) => {
        console.error('[/api/media] upstream stream error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'proxy_failed', detail: err.message });
        } else {
          res.destroy();
        }
      });
    }
  );

  proxyReq.setTimeout(MEDIA_PROXY_TIMEOUT_MS, () => {
    proxyReq.destroy();
    console.error(
      `[/api/media] upstream timeout after ${MEDIA_PROXY_TIMEOUT_MS}ms video=${videoId || '?'}`
    );
    if (!res.headersSent) {
      res.status(504).json({
        error: 'proxy_timeout',
        detail: `upstream timed out after ${MEDIA_PROXY_TIMEOUT_MS}ms`,
      });
    }
  });

  proxyReq.on('error', (err) => {
    console.error('[/api/media] proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'proxy_failed', detail: err.message });
    }
  });

  req.on('close', () => {
    if (!res.writableEnded) {
      proxyReq.destroy();
    }
  });

  proxyReq.end();
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    bridge: { port: PORT, host: HOST },
    resolver: 'bunny-stream',
    bunnyLibraryId: bunnyStream.BUNNY_LIBRARY_ID || null,
    bunnyConfigured: BUNNY_CONFIGURED,
    ingestResolvers: {
      ytdlp: bunnyStream.isIngestResolverConfigured(),
    },
    ingestReady: bunnyStream.isIngestResolverConfigured(),
    ytdlpBinary: bunnyStream.ingestYtdlp.resolveYtDlpBinary(),
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

app.get('/api/stream/:videoId/status', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }

  const rawQuality = req.query.quality;
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');
  const cached = lookupResolveCacheEntry(videoId, rawQuality, '360p');
  if (cached.entry) {
    return res.json(buildStreamJsonResponse(req, videoId, rawQuality, cached.entry));
  }

  const job = streamPrepareJobs.get(cacheKey);
  if (job?.status === 'ready' && job.cached) {
    return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
  }
  if (job?.status === 'processing') {
    return res.status(202).json(buildProcessingStatusResponse(req, videoId, rawQuality, job));
  }
  if (job?.status === 'failed' && job.error) {
    if (isRetryableStreamPrepareError(job.error)) {
      console.warn(
        `[/api/stream/status] retrying failed prepare video=${videoId} reason=${job.error.message?.slice(0, 120) || job.error}`
      );
      streamPrepareJobs.delete(cacheKey);
      const restarted = startStreamPrepare(videoId, rawQuality, { forceRestart: true });
      if (restarted.status === 'ready' && restarted.cached) {
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, restarted.cached));
      }
      return res.status(202).json(buildProcessingStatusResponse(req, videoId, rawQuality, restarted));
    }
    const classified = classifyStreamResolveError(job.error);
    return res.status(classified.status).json(classified.body);
  }

  // No active job — start one so polling after async=1 never gets stuck on idle.
  const restarted = startStreamPrepare(videoId, rawQuality);
  if (restarted.status === 'ready' && restarted.cached) {
    return res.json(buildStreamJsonResponse(req, videoId, rawQuality, restarted.cached));
  }
  return res.status(202).json(buildProcessingStatusResponse(req, videoId, rawQuality, restarted));
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }

  const rawQuality = req.query.quality;
  const useAsync = req.query.async === '1' || req.query.async === 'true';

  try {
    const cachedLookup = lookupResolveCacheEntry(videoId, rawQuality, '360p');
    if (cachedLookup.entry) {
      const payload = buildStreamJsonResponse(req, videoId, rawQuality, cachedLookup.entry);
      console.log(
        `[api/stream] ${videoId} ${payload.source} cache hit=${cachedLookup.lookup} quality=${payload.quality}`
      );
      return res.json(payload);
    }

    if (useAsync) {
      const job = startStreamPrepare(videoId, rawQuality);
      if (job.status === 'ready' && job.cached) {
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
      }

      if (job.promise) {
        await Promise.race([job.promise.catch(() => null), sleepMs(ASYNC_STREAM_QUICK_READY_MS)]);
        if (job.status === 'ready' && job.cached) {
          return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
        }
      }

      console.log(`[api/stream] ${videoId} async=1 → processing (background resolve started)`);
      return res.status(202).json({
        ...buildProcessingStatusResponse(req, videoId, rawQuality, job),
        pollUrl: streamStatusPollUrl(req, videoId, rawQuality),
      });
    }

    const quality = normalizeStreamQuality(rawQuality, '360p');
    const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');
    const cached = await getCachedUpstreamUrl(videoId, rawQuality);
    const payload = buildStreamJsonResponse(req, videoId, rawQuality, cached);

    console.log(
      `[api/stream] ${videoId} ${payload.source} requested=${quality} cache=${cacheKey} resolved=${payload.quality}`
    );

    res.json(payload);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error('[/api/stream] failed:', msg);
    const classified = classifyStreamResolveError(err);
    res.status(classified.status).json(classified.body);
  }
});

app.get('/api/media/:videoId', async (req, res) => {
  const { videoId } = req.params;

  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }

  const rawQuality = req.query.quality;
  const quality = normalizeStreamQuality(rawQuality, '360p');
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');

  try {
    const lookup = lookupResolveCacheEntry(videoId, rawQuality, '360p');
    const cached =
      lookup.entry || (await getCachedUpstreamUrl(videoId, rawQuality));

    console.log(
      `[/api/media] ${videoId} requested=${quality} cache=${cacheKey} lookup=${lookup.lookup} hit=${Boolean(cached?.upstreamUrl)} source=${cached?.source || '?'}`
    );

    if (
      cached.source === 'bunny' &&
      cached.upstreamUrl?.startsWith('http') &&
      (cached.proxied === false || /\.m3u8(\?|$)/i.test(cached.upstreamUrl))
    ) {
      return res.redirect(302, cached.upstreamUrl);
    }

    proxyUpstreamMedia(req, res, cached.upstreamUrl, {
      videoId,
      quality,
      cacheKey,
      source: cached.source || null,
      refreshUpstream: async () => {
        const fresh = await getCachedUpstreamUrl(videoId, rawQuality, { forceRefresh: true });
        return fresh && fresh.upstreamUrl ? fresh.upstreamUrl : null;
      },
    });
  } catch (err) {
    console.error(`[/api/media] failed video=${videoId} quality=${quality}:`, err.message);
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
    const info = await getVideoInfo(videoId);
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
  try {
    ensureYtDlpBinary({ strict: false, probe: true });
  } catch (err) {
    console.error(`[bridge] yt-dlp startup check failed: ${err.message}`);
    if (err.stderr) console.error(`[bridge] yt-dlp stderr:\n${err.stderr}`);
  }

  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(
    `[bridge] YouTube resolver: Bunny Stream (library=${bunnyStream.BUNNY_LIBRARY_ID || '?'})`
  );
  if (!BUNNY_CONFIGURED) {
    console.error(
      '[bridge] WARNING: BUNNY_STREAM_API_KEY and/or BUNNY_LIBRARY_ID not set — /api/stream will fail.'
    );
  }
  if (!bunnyStream.isIngestResolverConfigured()) {
    console.error(
      '[bridge] WARNING: yt-dlp not found — run `npm run download-tools` in server/ or set YT_DLP_BINARY_PATH. Bunny ingest will fail.'
    );
  } else {
    console.log(`[bridge] Bunny ingest: yt-dlp (${bunnyStream.ingestYtdlp.resolveYtDlpBinary()})`);
    const proxyMode = bunnyStream.ingestYtdlp.describeProxyMode();
    if (proxyMode.configured) {
      console.log(
        `[bridge] yt-dlp proxy: ${proxyMode.endpoint} mode=${proxyMode.mode}` +
          ` retries=${proxyMode.maxRetries} delayMs=${proxyMode.retryDelayMs}`
      );
    } else {
      console.log('[bridge] yt-dlp proxy: (none — datacenter egress, bot blocks likely)');
    }
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
