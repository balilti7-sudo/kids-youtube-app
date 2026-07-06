// server/index.cjs — SafeTube Media Bridge
// YouTube playback: client-side InnerTube (USE_CLIENT_STREAM_RESOLVE=1) or legacy Bunny/yt-dlp.

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
const streamStatusStore = require('./stream-status-store.cjs');
const { searchYouTube } = require('./youtube-search.cjs');
const { ensureYtDlpBinary } = require('./ensure-ytdlp.cjs');
const youtubeInnertube = require('./youtube-innertube.cjs');
const innertubeProxy = require('./innertube-proxy.cjs');

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

function buildCorsOptions() {
  const raw = String(process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || '').trim();
  const common = {
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With'],
    maxAge: 86400,
  };
  if (!raw || raw === '*') {
    return { ...common, origin: true };
  }
  const allowed = new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return {
    ...common,
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      console.warn(`[cors] blocked origin: ${origin}`);
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '8mb' }));

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
/** Legacy in-process jobs when USE_INGEST_WORKER=0 (local dev without Supabase queue). */
const streamPrepareJobs = new Map();

function useClientStreamResolve() {
  const flag = String(process.env.USE_CLIENT_STREAM_RESOLVE || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return false;
}

function useIngestWorker() {
  if (useClientStreamResolve()) return false;
  const flag = String(process.env.USE_INGEST_WORKER || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  return streamStatusStore.isConfigured();
}

/** Job stub used when the browser (not the server) resolves stream URLs. */
function buildClientResolveJob(videoId, rawQuality) {
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');
  return {
    status: 'processing',
    cacheKey,
    startedAt: Date.now(),
    expiresAt: Date.now() + STREAM_PREPARE_TTL_MS,
    cached: null,
    error: null,
    promise: null,
    progress: {
      phase: 'client_resolve',
      detail: 'Waiting for browser InnerTube registration (POST client-ready)',
      activeSource: 'client',
      retryAfterMs: 0,
    },
  };
}

function buildClientResolveStatusResponse(req, videoId, rawQuality) {
  return {
    status: 'client_resolve',
    videoId,
    quality: normalizeStreamQuality(rawQuality, '360p'),
    source: 'client',
    activeSource: 'client',
    resolveMode: 'innertube',
    phase: 'client_resolve',
    detail: 'Resolve in the browser, then POST /api/stream/:videoId/client-ready',
    metadataUrl: `${publicBridgeOrigin(req)}/api/youtube/metadata/${encodeURIComponent(videoId)}`,
    retryAfterMs: 0,
    pollUrl: streamStatusPollUrl(req, videoId, rawQuality),
  };
}

async function fetchOembedVideoInfo(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  const oembedRes = await fetch(oembedUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'user-agent': MEDIA_USER_AGENT },
  });
  if (!oembedRes.ok) {
    throw new Error(`YouTube oEmbed unavailable (${oembedRes.status})`);
  }
  const oembed = await oembedRes.json();
  const thumbUrl = typeof oembed.thumbnail_url === 'string' ? oembed.thumbnail_url : null;
  return {
    title: oembed.title || null,
    lengthSeconds: null,
    author: oembed.author_name || null,
    ownerChannelName: oembed.author_name || null,
    externalChannelId: null,
    thumbnail: thumbUrl ? [{ url: thumbUrl }] : [],
    isLiveContent: false,
    liveBroadcastDetails: { isLiveNow: false },
  };
}

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
    proxied: meta.proxied,
    requestedQuality: meta.requestedQuality || null,
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  };
}

/** Accept only googlevideo / YouTube videoplayback URLs from the client resolver. */
function isAllowedClientPlaybackUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/^https?:$/i.test(u.protocol)) return false;
    return (
      /(^|\.)googlevideo\.com$/i.test(u.hostname) ||
      (/youtube\.com$/i.test(u.hostname) && /videoplayback/i.test(u.pathname + u.search))
    );
  } catch {
    return false;
  }
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
    source: cached.source || 'direct',
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
  if (/no direct media url|no fetchable media url|missing direct media url|returned no direct|invalid media url/i.test(msg)) {
    return false;
  }
  if (/error code:\s*152|video_unavailable_152|yt-dlp json error.*152/i.test(msg)) {
    return false;
  }
  if (/exit.?152|\byt_dlp_152\b|yt-dlp json error|bot check|not a bot|youtubebotblock/i.test(msg)) {
    return false;
  }
  if (/proxy connection refused|errno 111|econnrefused/i.test(msg)) {
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
    err?.ytDlpErrorCode152Unavailable ||
    /error code:\s*152/i.test(msg)
  ) {
    return {
      status: 502,
      body: {
        status: 'failed',
        error: 'VIDEO_UNAVAILABLE_152',
        detail: msg.split('\n').slice(0, 3).join(' '),
      },
    };
  }
  if (
    err?.exitCode === 152 ||
    err?.youtubeBotBlock ||
    /exit.?152|yt-dlp json error|bot check|not a bot/i.test(msg)
  ) {
    return {
      status: 502,
      body: {
        status: 'failed',
        error: 'YT_DLP_BOT_BLOCK',
        detail: msg.split('\n').slice(0, 3).join(' '),
      },
    };
  }
  if (
    err?.exitCode === 111 ||
    err?.proxyConnectionRefused ||
    /proxy connection refused|errno 111|econnrefused/i.test(msg)
  ) {
    return {
      status: 502,
      body: {
        status: 'failed',
        error: 'PROXY_CONNECTION_REFUSED',
        detail: msg.split('\n').slice(0, 3).join(' '),
      },
    };
  }
  if (/invalid media url|no direct media url|no fetchable media url/i.test(msg)) {
    return {
      status: 502,
      body: {
        status: 'failed',
        error: 'INVALID_MEDIA_URL',
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

function supabaseRowToError(row) {
  const err = new Error(
    row?.error_detail || row?.error_code || 'Video ingest failed'
  );
  if (row?.error_code) err.errorCode = row.error_code;
  if (row?.error_code === 'VIDEO_UNAVAILABLE_152') {
    err.ytDlpErrorCode152Unavailable = true;
    err.exitCode = 152;
  }
  return err;
}

/** googlevideo direct URLs carry an `expire=<unix seconds>` param and die after ~6h. */
function isExpiredDirectUrl(url) {
  const match = /[?&]expire=(\d{9,11})(?:&|$)/.exec(String(url || ''));
  if (!match) return false;
  return Number(match[1]) * 1000 < Date.now() + 60_000;
}

/** Legacy Bunny-era row — stale for the direct-streaming flow; force re-ingest. */
function isLegacyBunnyRow(row) {
  const url = String(row?.playback_url || '');
  // A googlevideo / videoplayback URL is always direct, even if legacy metadata remains.
  if (/googlevideo\.com|youtube\.com\/videoplayback/i.test(url)) return false;
  if (row?.source === 'direct') return false;
  if (row?.source === 'bunny') return true;
  if (row?.bunny_guid) return true;
  return /bunnycdn\.com|b-cdn\.net|mediadelivery\.net/i.test(url);
}

/** Debounce stale-row requeues so status polling cannot reset a ready job every 3s. */
const staleRequeueAt = new Map();
const STALE_REQUEUE_COOLDOWN_MS = 60_000;

function shouldRequeueStaleReady(cacheKey) {
  const last = staleRequeueAt.get(cacheKey) || 0;
  if (Date.now() - last < STALE_REQUEUE_COOLDOWN_MS) return false;
  staleRequeueAt.set(cacheKey, Date.now());
  return true;
}

/**
 * Build a cache entry from a Supabase ready row, or null when the URL is stale.
 * When `requeueIfStale` is true and the row is stale, re-enqueues at most once
 * per minute (prevents poll loops from undoing a worker's markReady).
 */
function readyEntryFromSupabaseRow(row, rawQuality, cacheKey, { requeueIfStale = false } = {}) {
  const entry = cacheEntryFromSupabaseRow(row, rawQuality);
  if (entry || !requeueIfStale || row?.status !== 'ready') return entry;
  if (!shouldRequeueStaleReady(cacheKey)) return null;
  console.warn(
    `[stream] stale playback_url for ${row.youtube_video_id} (${isLegacyBunnyRow(row) ? 'legacy bunny' : 'expired'}) — re-enqueueing for direct URL`
  );
  void streamStatusStore.markQueued(row.youtube_video_id, rawQuality).catch(() => {});
  return null;
}

function cacheEntryFromSupabaseRow(row, rawQuality) {
  if (!row?.playback_url) return null;
  const url = row.playback_url;
  // Direct-streaming only: Bunny rows and expired googlevideo URLs are both
  // treated as not-ready so the caller re-enqueues the ingest job.
  if (isLegacyBunnyRow(row)) return null;
  if (isExpiredDirectUrl(url)) return null;
  const quality = normalizeStreamQuality(rawQuality, '360p');
  const isHls = /\.m3u8(\?|$)/i.test(url) || /playlist\.m3u8/i.test(url);
  return buildResolveCacheEntry(url, {
    quality,
    mime: isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    source: 'direct',
    proxied: false,
    bunnyGuid: null,
  });
}

function buildApiJobFromSupabase(row, videoId, rawQuality, cacheKey) {
  if (!row) {
    return {
      status: 'processing',
      cacheKey,
      startedAt: Date.now(),
      expiresAt: Date.now() + STREAM_PREPARE_TTL_MS,
      cached: null,
      error: null,
      promise: null,
      progress: {
        phase: 'queued',
        detail: 'Queued for ingest worker',
        retryAfterMs: 3000,
        activeSource: 'direct',
      },
    };
  }

  if (row.status === 'ready') {
    const entry = cacheEntryFromSupabaseRow(row, rawQuality);
    if (entry) {
      resolveCacheSet(cacheKey, entry.upstreamUrl, entry);
      return {
        status: 'ready',
        cacheKey,
        cached: entry,
        promise: null,
        progress: { phase: 'ready', detail: 'Playback ready' },
      };
    }
    // Stale ready row — report processing; requeue is handled by the caller when appropriate.
    return {
      status: 'processing',
      cacheKey,
      startedAt: Date.now(),
      expiresAt: Date.now() + STREAM_PREPARE_TTL_MS,
      cached: null,
      error: null,
      promise: null,
      progress: {
        phase: 'queued',
        detail: 'Refreshing direct stream URL',
        retryAfterMs: 3000,
        activeSource: 'direct',
      },
    };
  }

  if (row.status === 'failed') {
    return {
      status: 'failed',
      cacheKey,
      cached: null,
      error: supabaseRowToError(row),
      promise: null,
      progress: { phase: 'failed', detail: row.error_detail || row.error_code },
    };
  }

  return {
    status: 'processing',
    cacheKey,
    startedAt: Date.now(),
    expiresAt: Date.now() + STREAM_PREPARE_TTL_MS,
    cached: null,
    error: null,
    promise: null,
    progress: {
      phase: row.status === 'queued' ? 'queued' : 'processing',
      detail:
        row.status === 'queued'
          ? 'Waiting for ingest worker'
          : 'Ingest worker processing',
      retryAfterMs: 3000,
      activeSource: 'direct',
    },
  };
}

async function startStreamPrepare(videoId, rawQuality, { forceRestart = false } = {}) {
  const cacheKey = resolveCacheKey(videoId, rawQuality, '360p');
  const cached = lookupResolveCacheEntry(videoId, rawQuality, '360p');
  if (cached.entry) {
    return { status: 'ready', cacheKey, cached: cached.entry, promise: null };
  }

  // Client-side InnerTube mode — never enqueue worker jobs or run inline yt-dlp/Bunny.
  if (useClientStreamResolve()) {
    return buildClientResolveJob(videoId, rawQuality);
  }

  if (useIngestWorker()) {
    // Fast path: worker already marked ready — skip enqueue round-trip.
    const existing = await streamStatusStore.getJob(videoId, rawQuality);
    if (existing?.status === 'ready' && existing.playback_url) {
      const entry = readyEntryFromSupabaseRow(existing, rawQuality, cacheKey, {
        requeueIfStale: true,
      });
      if (entry) {
        resolveCacheSet(cacheKey, entry.upstreamUrl, entry);
        return { status: 'ready', cacheKey, cached: entry, promise: null };
      }
    }

    const row = await streamStatusStore.enqueue(videoId, rawQuality, { forceRestart });
    const job = buildApiJobFromSupabase(row, videoId, rawQuality, cacheKey);
    console.log(
      `[stream-prepare] enqueued video=${videoId} quality=${rawQuality || '360p'} status=${row?.status || 'queued'}`
    );
    return job;
  }

  return startStreamPrepareInline(videoId, rawQuality, { forceRestart });
}

function startStreamPrepareInline(videoId, rawQuality, { forceRestart = false } = {}) {
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
      void streamStatusStore.markReady(videoId, rawQuality);
      return resolved;
    })
    .catch((err) => {
      console.error(
        `[stream-prepare] failed video=${videoId} quality=${rawQuality || '360p'}: ${err?.message || err}`
      );
      job.status = 'failed';
      job.error = err;
      job.cached = null;
      void streamStatusStore.markFailed(videoId, rawQuality, err);
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
  void streamStatusStore.markProcessing(videoId, rawQuality);

  return job;
}

function buildProcessingStatusResponse(req, videoId, rawQuality, job) {
  const progress = job?.progress || {};
  return {
    status: 'processing',
    videoId,
    retryAfterMs: progress.retryAfterMs || 3000,
    elapsedMs: job ? Date.now() - (job.startedAt || Date.now()) : 0,
    phase: progress.phase || 'processing',
    activeSource: progress.activeSource || 'direct',
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
  if (useClientStreamResolve()) {
    throw new Error(
      'CLIENT_RESOLVE_REQUIRED: server-side resolve disabled — browser must POST /api/stream/:videoId/client-ready'
    );
  }
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
  if (useClientStreamResolve() || !BUNNY_CONFIGURED) {
    return fetchOembedVideoInfo(videoId);
  }
  return bunnyStream.getVideoInfo(videoId);
}

async function getCachedUpstreamUrl(
  videoId,
  rawQuality = '360p',
  { forceRefresh = false, progress = null } = {}
) {
  if (useClientStreamResolve()) {
    throw new Error(
      'CLIENT_RESOLVE_REQUIRED: POST /api/stream/:videoId/client-ready before requesting media'
    );
  }

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
  if (/googlevideo\.com/i.test(upstream.hostname) || /videoplayback/i.test(upstreamUrl)) {
    headers.Referer = 'https://www.youtube.com/';
    headers.Origin = 'https://www.youtube.com';
  }
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
    resolver: useClientStreamResolve() ? 'client-innertube' : 'bunny-stream',
    clientStreamResolve: useClientStreamResolve(),
    bunnyLibraryId: bunnyStream.BUNNY_LIBRARY_ID || null,
    bunnyConfigured: BUNNY_CONFIGURED,
    ingestResolvers: {
      ytdlp: !useClientStreamResolve() && bunnyStream.isIngestResolverConfigured(),
    },
    ingestWorkerMode: useIngestWorker(),
    ingestQueueConfigured: streamStatusStore.isConfigured(),
    ingestReady: useClientStreamResolve() || bunnyStream.isIngestResolverConfigured(),
    ytdlpBinary: useClientStreamResolve() ? null : bunnyStream.ingestYtdlp.resolveYtDlpBinary(),
  });
});

app.get('/api/diagnostics', async (_req, res) => {
  try {
    let web;
    if (useClientStreamResolve()) {
      web = {
        clientStreamResolve: true,
        note: 'Server yt-dlp/Bunny egress diagnostics disabled in client-side resolve mode',
      };
    } else {
      web = await bunnyStream.ingestYtdlp.runEgressDiagnostics();
    }

    let workers = [];
    if (!useClientStreamResolve()) {
      try {
        workers = await streamStatusStore.getWorkerDiagnostics();
      } catch (err) {
        console.warn('[/api/diagnostics] worker diagnostics read failed:', err?.message || err);
      }
    }

    res.json({
      ok: true,
      service: 'safetube-media-bridge',
      clientStreamResolve: useClientStreamResolve(),
      ingestWorkerMode: useIngestWorker(),
      web,
      workers,
    });
  } catch (err) {
    console.error('[/api/diagnostics] failed:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'diagnostics failed' });
  }
});

/** Public stream mode — frontend can confirm client-side resolve without guessing env vars. */
app.get('/api/stream/config', (_req, res) => {
  res.json({
    clientStreamResolve: useClientStreamResolve(),
    ingestWorkerMode: useIngestWorker(),
    resolver: useClientStreamResolve() ? 'client-innertube' : useIngestWorker() ? 'worker' : 'server',
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

/** Lightweight metadata (no yt-dlp) for client-side stream resolution. */
app.get('/api/youtube/metadata/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const oembedRes = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': MEDIA_USER_AGENT },
    });
    if (!oembedRes.ok) {
      return res.status(oembedRes.status).json({
        error: 'metadata_unavailable',
        detail: `oEmbed ${oembedRes.status}`,
      });
    }
    const oembed = await oembedRes.json();
    res.json({
      videoId,
      title: oembed.title || null,
      author: oembed.author_name || null,
      thumbnail: oembed.thumbnail_url || null,
      resolveMode: useClientStreamResolve() ? 'client' : 'server',
    });
  } catch (err) {
    console.error('[/api/youtube/metadata] failed:', err?.message || err);
    res.status(502).json({ error: 'metadata_failed', detail: err?.message || 'metadata failed' });
  }
});

/**
 * Resolve a googlevideo URL via InnerTube on the bridge (no browser → YouTube CORS).
 * Frontend calls this instead of bundling youtubei.js against youtube.com directly.
 */
app.get('/api/youtube/resolve/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  if (!useClientStreamResolve()) {
    return res.status(403).json({
      error: 'client_resolve_disabled',
      detail: 'Set USE_CLIENT_STREAM_RESOLVE=1 on the bridge',
    });
  }

  const quality = normalizeStreamQuality(req.query.quality);
  try {
    const resolved = await youtubeInnertube.resolveYoutubeStream(videoId, quality);
    console.log(
      `[innertube/resolve] video=${videoId} quality=${quality} url=${resolved.playbackUrl.slice(0, 72)}…`
    );
    res.json({
      videoId,
      quality: resolved.quality,
      playbackUrl: resolved.playbackUrl,
      mime: resolved.mime,
      format: resolved.format,
      source: 'innertube',
    });
  } catch (err) {
    console.error(`[/api/youtube/resolve] failed video=${videoId}:`, err?.message || err);
    res.status(502).json({
      error: 'innertube_resolve_failed',
      detail: String(err?.message || err).slice(0, 500),
    });
  }
});

/**
 * Generic CORS-safe proxy for youtubei.js fetch (browser → bridge → YouTube).
 * Prefer GET /api/youtube/resolve/:videoId when possible (single round-trip).
 */
app.post('/api/youtube/innertube-proxy', async (req, res) => {
  if (!useClientStreamResolve()) {
    return res.status(403).json({ error: 'client_resolve_disabled' });
  }

  try {
    const forwarded = await innertubeProxy.forwardInnertubeRequest(req.body, {
      userAgent: MEDIA_USER_AGENT,
    });
    res.status(200).json(forwarded);
  } catch (err) {
    const code = err?.code === 'INVALID_PROXY_URL' ? 400 : 502;
    console.error('[/api/youtube/innertube-proxy] failed:', err?.message || err);
    res.status(code).json({
      error: err?.code || 'innertube_proxy_failed',
      detail: err?.message || 'proxy failed',
    });
  }
});

/**
 * Client-side InnerTube resolver registers a googlevideo URL for proxied playback.
 * The bridge never runs yt-dlp here — it only stores the URL and serves /api/media.
 */
app.post('/api/stream/:videoId/client-ready', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  if (!useClientStreamResolve()) {
    return res.status(403).json({
      error: 'client_resolve_disabled',
      detail: 'Set USE_CLIENT_STREAM_RESOLVE=1 on the bridge',
    });
  }

  const quality = normalizeStreamQuality(req.body?.quality);
  const playbackUrl = String(req.body?.playbackUrl || req.body?.url || '').trim();
  if (!isAllowedClientPlaybackUrl(playbackUrl)) {
    return res.status(400).json({ error: 'invalid_playback_url' });
  }

  const cacheKey = resolveCacheKey(videoId, quality);
  const mime = String(req.body?.mime || req.body?.mimeType || 'video/mp4');
  const entry = buildResolveCacheEntry(playbackUrl, {
    quality,
    mime,
    source: 'client',
    proxied: true,
    requestedQuality: quality,
  });
  resolveCache.set(cacheKey, entry);

  console.log(
    `[client-ready] video=${videoId} quality=${quality} cached for media proxy (${playbackUrl.slice(0, 72)}…)`
  );

  return res.json(buildStreamJsonResponse(req, videoId, quality, entry));
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

  if (useClientStreamResolve()) {
    return res.status(202).json(buildClientResolveStatusResponse(req, videoId, rawQuality));
  }

  if (useIngestWorker()) {
    const row = await streamStatusStore.getJob(videoId, rawQuality);

    // FAST PATH: worker finished — return the direct URL immediately (no enqueue,
    // no Bunny checks, no side effects beyond populating the in-memory cache).
    if (row?.status === 'ready' && row.playback_url) {
      const entry = readyEntryFromSupabaseRow(row, rawQuality, cacheKey, {
        requeueIfStale: true,
      });
      if (entry) {
        resolveCacheSet(cacheKey, entry.upstreamUrl, entry);
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, entry));
      }
    }

    let activeRow = row;

    if (activeRow?.status === 'failed') {
      if (streamStatusStore.isRetryableErrorCode(activeRow.error_code)) {
        console.warn(
          `[/api/stream/status] re-queue video=${videoId} error=${activeRow.error_code || '?'}`
        );
        activeRow = await streamStatusStore.enqueue(videoId, rawQuality, { forceRestart: true });
      } else {
        const classified = classifyStreamResolveError(supabaseRowToError(activeRow));
        return res.status(classified.status).json(classified.body);
      }
    }

    if (!activeRow || activeRow.status === 'failed') {
      activeRow = await streamStatusStore.enqueue(videoId, rawQuality);
    }

    const job = buildApiJobFromSupabase(activeRow, videoId, rawQuality, cacheKey);
    if (job.status === 'ready' && job.cached) {
      return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
    }
    if (job.status === 'failed' && job.error) {
      const classified = classifyStreamResolveError(job.error);
      return res.status(classified.status).json(classified.body);
    }
    return res.status(202).json(buildProcessingStatusResponse(req, videoId, rawQuality, job));
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
      const restarted = await startStreamPrepare(videoId, rawQuality, { forceRestart: true });
      if (restarted.status === 'ready' && restarted.cached) {
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, restarted.cached));
      }
      return res.status(202).json(buildProcessingStatusResponse(req, videoId, rawQuality, restarted));
    }
    const classified = classifyStreamResolveError(job.error);
    return res.status(classified.status).json(classified.body);
  }

  const restarted = await startStreamPrepare(videoId, rawQuality);
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

    if (useClientStreamResolve()) {
      return res.status(202).json(buildClientResolveStatusResponse(req, videoId, rawQuality));
    }

    if (useAsync) {
      const job = await startStreamPrepare(videoId, rawQuality);
      if (job.status === 'ready' && job.cached) {
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
      }

      if (!useIngestWorker() && job.promise) {
        await Promise.race([job.promise.catch(() => null), sleepMs(ASYNC_STREAM_QUICK_READY_MS)]);
        if (job.status === 'ready' && job.cached) {
          return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
        }
      }

      console.log(
        `[api/stream] ${videoId} async=1 → ${useIngestWorker() ? 'queued' : 'processing'} (no yt-dlp on API)`
      );
      return res.status(202).json({
        ...buildProcessingStatusResponse(req, videoId, rawQuality, job),
        pollUrl: streamStatusPollUrl(req, videoId, rawQuality),
      });
    }

    if (useIngestWorker()) {
      const job = await startStreamPrepare(videoId, rawQuality);
      if (job.status === 'ready' && job.cached) {
        return res.json(buildStreamJsonResponse(req, videoId, rawQuality, job.cached));
      }
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
    if (lookup.entry) {
      const cached = lookup.entry;
      if (
        cached.source === 'bunny' &&
        cached.upstreamUrl?.startsWith('http') &&
        (cached.proxied === false || /\.m3u8(\?|$)/i.test(cached.upstreamUrl))
      ) {
        return res.redirect(302, cached.upstreamUrl);
      }
      return proxyUpstreamMedia(req, res, cached.upstreamUrl, {
        videoId,
        quality,
        cacheKey,
        source: cached.source || null,
      });
    }

    if (useIngestWorker()) {
      const row = await streamStatusStore.getJob(videoId, rawQuality);
      if (row?.status === 'ready' && row.playback_url) {
        const entry = readyEntryFromSupabaseRow(row, rawQuality, cacheKey, {
          requeueIfStale: true,
        });
        if (entry) {
          resolveCacheSet(cacheKey, entry.upstreamUrl, entry);
          return res.redirect(302, entry.upstreamUrl);
        }
      }

      await streamStatusStore.enqueue(videoId, rawQuality);
      return res.status(503).json({
        error: 'FILE_NOT_READY',
        detail: 'Video ingest queued — poll /api/stream/:videoId/status',
        retryAfterSec: 15,
      });
    }

    if (useClientStreamResolve()) {
      return res.status(503).json({
        error: 'FILE_NOT_READY',
        detail: 'Client must POST /api/stream/:videoId/client-ready before media playback',
        clientResolve: true,
        retryAfterSec: 2,
      });
    }

    const cached = await getCachedUpstreamUrl(videoId, rawQuality);

    console.log(
      `[/api/media] ${videoId} requested=${quality} cache=${cacheKey} hit=${Boolean(cached?.upstreamUrl)} source=${cached?.source || '?'}`
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
      refreshUpstream: useIngestWorker()
        ? null
        : async () => {
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
  if (!useClientStreamResolve()) {
    try {
      ensureYtDlpBinary({ strict: false, probe: true });
    } catch (err) {
      console.error(`[bridge] yt-dlp startup check failed: ${err.message}`);
      if (err.stderr) console.error(`[bridge] yt-dlp stderr:\n${err.stderr}`);
    }
  }

  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  if (useClientStreamResolve()) {
    console.log(
      '[bridge] YouTube resolver: CLIENT (browser InnerTube) — yt-dlp worker disabled; playback via /api/media proxy'
    );
  } else {
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
        '[bridge] WARNING: yt-dlp not found — run `npm run download-tools` in server/ or set YT_DLP_BINARY_PATH.'
      );
    } else if (useIngestWorker()) {
      console.log(
        '[bridge] ingest mode: API enqueue-only — run `node ingest-worker.cjs` (or Render worker) for yt-dlp'
      );
    } else {
      console.log(`[bridge] Bunny ingest: inline yt-dlp (${bunnyStream.ingestYtdlp.resolveYtDlpBinary()})`);
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
  }
});

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
