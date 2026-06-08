// server/index.js — SafeTube Bridge (RapidAPI resolver, no yt-dlp)

'use strict';

const express = require('express');
const cors = require('cors');
const rapidApi = require('./rapidapi-youtube');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}  from=${req.ip}`);
  next();
});

const RESOLVE_CACHE_TTL_MS = Number(process.env.RESOLVE_CACHE_TTL_MS || 8 * 60 * 1000);
const resolveCache = new Map();

async function getCachedUpstreamUrl(videoId) {
  const hit = resolveCache.get(videoId);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const resolved = await rapidApi.resolveVideoDownloadUrl(videoId);
  const entry = {
    upstreamUrl: resolved.url,
    quality: resolved.quality,
    mime: resolved.mime,
    expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
  };
  resolveCache.set(videoId, entry);
  return entry;
}

function readLiveMetaFromInfo(info) {
  const isLive = Boolean(info.liveBroadcastDetails?.isLiveNow) || Boolean(info.isLiveContent);
  const liveStatus = isLive ? 'is_live' : 'not_live';
  return { liveStatus, isUpcoming: false, isLive };
}

async function resolveLiveMeta(videoId) {
  const info = await rapidApi.getVideoInfo(videoId);
  return readLiveMetaFromInfo(info);
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    bridge: { port: PORT, host: HOST },
    resolver: 'rapidapi',
    rapidApiHost: rapidApi.RAPIDAPI_HOST,
    rapidApiKeyConfigured: Boolean(process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_YOUTUBE_KEY),
  });
});

app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const liveMeta = await resolveLiveMeta(videoId);
    if (liveMeta.isUpcoming) {
      return res.status(422).json({
        error: 'LIVE_UPCOMING',
        live_status: liveMeta.liveStatus,
        detail: 'This live broadcast has not started yet.',
      });
    }
    const cached = await getCachedUpstreamUrl(videoId);
    res.json({
      videoId,
      client: 'rapidapi',
      url: cached.upstreamUrl,
      live_status: liveMeta.liveStatus,
      is_live: liveMeta.isLive,
    });
  } catch (err) {
    console.error('[/api/stream] failed:', err.message);
    res.status(502).json({ error: 'resolve_failed', detail: err.message.split('\n').slice(0, 3) });
  }
});

app.get('/api/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'invalid videoId' });
  }
  try {
    const info = await rapidApi.getVideoInfo(videoId);
    const liveMeta = readLiveMetaFromInfo(info);
    const thumb =
      Array.isArray(info.thumbnail) && info.thumbnail.length > 0
        ? info.thumbnail[info.thumbnail.length - 1].url
        : null;
    res.json({
      videoId,
      client: 'rapidapi',
      title: info.title,
      duration: info.lengthSeconds ? Number(info.lengthSeconds) : null,
      uploader: info.author || info.ownerChannelName,
      channel_id: info.externalChannelId,
      thumbnail: thumb,
      live_status: liveMeta.liveStatus,
      is_live: liveMeta.isLive,
      is_upcoming: liveMeta.isUpcoming,
      formats: [],
    });
  } catch (err) {
    console.error('[/api/info] failed:', err.message);
    res.status(502).json({ error: 'resolve_failed', detail: err.message.split('\n').slice(0, 3) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] YouTube resolver: RapidAPI (${rapidApi.RAPIDAPI_HOST})`);
});
