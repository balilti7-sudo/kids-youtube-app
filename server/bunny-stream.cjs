'use strict';

const axios = require('axios');
const socialKit = require('./socialkit-youtube.cjs');
const rapidApi = require('./rapidapi-youtube.cjs');

const BUNNY_API_BASE = 'https://video.bunnycdn.com';
const BUNNY_STREAM_API_KEY = (process.env.BUNNY_STREAM_API_KEY || '').trim();
const BUNNY_LIBRARY_ID = (process.env.BUNNY_LIBRARY_ID || '').trim();
const BUNNY_CDN_HOSTNAME = (process.env.BUNNY_CDN_HOSTNAME || '').trim();
const BUNNY_REQUEST_TIMEOUT_MS = Number(process.env.BUNNY_REQUEST_TIMEOUT_MS || 30_000);
const BUNNY_TRANSCODE_POLL_MS = Number(process.env.BUNNY_TRANSCODE_POLL_MS || 4_000);
const BUNNY_TRANSCODE_MAX_MS = Number(process.env.BUNNY_TRANSCODE_MAX_MS || 600_000);
const BUNNY_INGEST_RESOLVE_TIMEOUT_MS = Number(process.env.BUNNY_INGEST_RESOLVE_TIMEOUT_MS || 30_000);
const LONG_VIDEO_DURATION_SEC = Number(process.env.LONG_VIDEO_DURATION_SEC || 65);

const SOCIALKIT_CONFIGURED = Boolean(
  process.env.SOCIALKIT_ACCESS_KEY || process.env.SOCIALKIT_API_KEY
);
const RAPIDAPI_CONFIGURED = Boolean(
  process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_YOUTUBE_KEY
);

/** Bunny VideoModelStatus */
const STATUS_FINISHED = 4;
const STATUS_ERROR = 5;
const STATUS_UPLOAD_FAILED = 6;
const PROCESSING_STATUSES = new Set([0, 1, 2, 3, 7, 8]);

const youtubeGuidCache = new Map();
let cachedLibraryHostname = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isConfigured() {
  return Boolean(BUNNY_STREAM_API_KEY && BUNNY_LIBRARY_ID);
}

function requireConfigured() {
  if (!BUNNY_STREAM_API_KEY) {
    throw new Error('BUNNY_STREAM_API_KEY is not set on the Media Bridge');
  }
  if (!BUNNY_LIBRARY_ID) {
    throw new Error('BUNNY_LIBRARY_ID is not set on the Media Bridge');
  }
}

function youtubeTitle(videoId) {
  return `yt-${videoId}`;
}

function isIngestResolverConfigured() {
  return SOCIALKIT_CONFIGURED || RAPIDAPI_CONFIGURED;
}

function videoUploadedAt(video) {
  const raw = video?.dateUploaded || video?.DateUploaded || video?.created || 0;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function pickBestLibraryMatch(matches) {
  if (!matches || matches.length === 0) return null;
  const playable = matches.find((v) => isPlayableStatus(v.status));
  if (playable) return playable;
  const processing = matches.find((v) => PROCESSING_STATUSES.has(v.status));
  if (processing) return processing;
  return [...matches].sort((a, b) => videoUploadedAt(b) - videoUploadedAt(a))[0];
}

async function deleteBunnyVideo(bunnyGuid, { reason = '' } = {}) {
  await bunnyRequest('DELETE', `/library/${BUNNY_LIBRARY_ID}/videos/${bunnyGuid}`);
  console.log(`[bunny] deleted guid=${bunnyGuid}${reason ? ` (${reason})` : ''}`);
}

async function getDurationHint(youtubeVideoId) {
  if (SOCIALKIT_CONFIGURED) {
    try {
      const info = await socialKit.getVideoInfo(youtubeVideoId);
      const sec = Number(info.lengthSeconds);
      if (Number.isFinite(sec) && sec > 0) return sec;
    } catch (err) {
      console.warn(`[bunny] duration hint SocialKit failed video=${youtubeVideoId}: ${err.message}`);
    }
  }

  if (RAPIDAPI_CONFIGURED) {
    try {
      const { durationSeconds } = await rapidApi.getAvailableQualities(youtubeVideoId);
      if (durationSeconds > 0) return durationSeconds;
    } catch (err) {
      console.warn(`[bunny] duration hint RapidAPI failed video=${youtubeVideoId}: ${err.message}`);
    }
  }

  return 0;
}

function buildIngestProviderChain(durationSeconds) {
  const isLong = durationSeconds <= 0 || durationSeconds > LONG_VIDEO_DURATION_SEC;
  const chain = [];
  if (isLong) {
    if (RAPIDAPI_CONFIGURED) chain.push('rapidapi');
    if (SOCIALKIT_CONFIGURED) chain.push('socialkit');
  } else {
    if (SOCIALKIT_CONFIGURED) chain.push('socialkit');
    if (RAPIDAPI_CONFIGURED) chain.push('rapidapi');
  }
  return { chain, isLong, durationSeconds };
}

/**
 * Resolve a direct, publicly fetchable media URL (mp4 CDN) for Bunny ingest.
 * SocialKit / RapidAPI are ingest-only helpers — playback is always Bunny HLS.
 */
async function resolveDirectMediaUrl(youtubeVideoId, quality, progress) {
  if (!isIngestResolverConfigured()) {
    throw new Error(
      'Bunny ingest requires SOCIALKIT_ACCESS_KEY and/or RAPIDAPI_KEY to resolve a direct media URL'
    );
  }

  const durationSeconds = await getDurationHint(youtubeVideoId);
  const { chain, isLong } = buildIngestProviderChain(durationSeconds);

  if (progress) {
    progress.durationSeconds = durationSeconds || null;
    progress.activeSource = 'bunny';
    progress.phase = 'source_resolve';
    progress.detail = 'Resolving direct media URL for Bunny ingest';
    progress.retryAfterMs = 3000;
  }

  let lastErr = null;
  for (const provider of chain) {
    if (progress) {
      progress.ingestResolver = provider;
      progress.detail = `Resolving direct URL via ${provider}`;
    }

    try {
      if (provider === 'socialkit') {
        const resolved = await socialKit.resolveVideoDownloadUrl(youtubeVideoId, quality, {
          fallbackAttempt: isLong,
          requestTimeoutMs: isLong ? BUNNY_INGEST_RESOLVE_TIMEOUT_MS : undefined,
        });
        console.log(
          `[bunny] ingest source socialkit video=${youtubeVideoId} url=${resolved.url.slice(0, 96)}…`
        );
        return { ...resolved, ingestResolver: 'socialkit' };
      }

      const resolved = await rapidApi.resolveVideoDownloadUrl(youtubeVideoId, quality);
      console.log(
        `[bunny] ingest source rapidapi video=${youtubeVideoId} url=${resolved.url.slice(0, 96)}…`
      );
      return { ...resolved, ingestResolver: 'rapidapi' };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[bunny] ingest resolve ${provider} failed video=${youtubeVideoId}: ${err.message}`
      );
    }
  }

  throw lastErr || new Error(`Failed to resolve direct media URL for ${youtubeVideoId}`);
}

function normalizeStreamQuality(raw, fallback = '360p') {
  const allowed = new Set(['240p', '360p', '480p', '720p', '1080p']);
  const q = String(raw || fallback).trim().toLowerCase();
  return allowed.has(q) ? q : fallback;
}

function statusLabel(status) {
  const map = {
    0: 'Created',
    1: 'Uploaded',
    2: 'Processing',
    3: 'Transcoding',
    4: 'Finished',
    5: 'Error',
    6: 'UploadFailed',
    7: 'JitSegmenting',
    8: 'JitPlaylistsCreated',
  };
  return map[status] ?? `Unknown(${status})`;
}

function isPlayableStatus(status) {
  return status === STATUS_FINISHED || status === 8;
}

function isFailedStatus(status) {
  return status === STATUS_ERROR || status === STATUS_UPLOAD_FAILED;
}

async function bunnyRequest(method, path, { body, params } = {}) {
  const url = `${BUNNY_API_BASE}${path}`;
  try {
    const res = await axios({
      method,
      url,
      headers: {
        AccessKey: BUNNY_STREAM_API_KEY,
        accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      data: body,
      params,
      timeout: BUNNY_REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Bunny Stream auth failed HTTP ${res.status}`);
    }
    if (res.status === 429) {
      const err = new Error('Bunny Stream fetch queue full (429) — retry later');
      err.fileNotReady = true;
      throw err;
    }
    if (res.status >= 400) {
      const detail =
        typeof res.data === 'object'
          ? res.data.message || JSON.stringify(res.data).slice(0, 300)
          : String(res.data || '').slice(0, 300);
      const err = new Error(`Bunny Stream HTTP ${res.status}: ${detail}`);
      if (res.status === 422 || /processing|not ready|fetch/i.test(detail)) {
        err.fileNotReady = true;
      }
      throw err;
    }
    return res.data;
  } catch (err) {
    if (err.fileNotReady || err.message?.startsWith('Bunny Stream')) throw err;
    const msg = err?.message || String(err);
    if (/timeout|timed out|econnaborted/i.test(msg)) {
      const wrapped = new Error(`Bunny Stream request timeout: ${msg}`);
      wrapped.fileNotReady = true;
      throw wrapped;
    }
    throw err;
  }
}

function normalizeHostname(raw) {
  if (!raw) return '';
  return String(raw).replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/')[0];
}

function hostnameFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const host = new URL(url).hostname;
    if (/\.b-cdn\.net$/i.test(host) || /bunnycdn\.com$/i.test(host) || /mediadelivery\.net$/i.test(host)) {
      return host;
    }
  } catch {
    /* ignore */
  }
  return '';
}

function pickHostnameFromObject(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const candidates = [
    obj.cdnHostname,
    obj.CdnHostname,
    obj.hostname,
    obj.Hostname,
    obj.PullZoneUrl,
    obj.pullZoneUrl,
    obj.cdnUrl,
    obj.CdnUrl,
  ];
  for (const candidate of candidates) {
    const direct = normalizeHostname(candidate);
    if (direct && !direct.includes(' ')) return direct;
    const fromUrl = hostnameFromUrl(candidate);
    if (fromUrl) return fromUrl;
  }
  if (Array.isArray(obj.Hostnames) && obj.Hostnames.length > 0) {
    const first = obj.Hostnames[0];
    const value = typeof first === 'string' ? first : first?.Value || first?.value;
    const fromList = normalizeHostname(value) || hostnameFromUrl(value);
    if (fromList) return fromList;
  }
  return '';
}

function hostnameFromVideoObject(video) {
  if (!video || typeof video !== 'object') return '';
  const urls = [
    video.cdnUrl,
    video.thumbnailUrl,
    video.previewUrl,
    video.mp4Url,
    video.playlistUrl,
    video.fallbackUrl,
  ];
  for (const url of urls) {
    const host = hostnameFromUrl(url);
    if (host) return host;
  }
  return '';
}

async function accountApiGet(path) {
  const res = await axios({
    method: 'GET',
    url: `https://api.bunny.net${path}`,
    headers: {
      AccessKey: BUNNY_STREAM_API_KEY,
      accept: 'application/json',
    },
    timeout: BUNNY_REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Bunny account API auth failed HTTP ${res.status}`);
  }
  if (res.status >= 400) {
    throw new Error(`Bunny account API HTTP ${res.status}`);
  }
  return res.data;
}

async function getLibraryHostname(video = null) {
  if (BUNNY_CDN_HOSTNAME) {
    return normalizeHostname(BUNNY_CDN_HOSTNAME);
  }
  if (cachedLibraryHostname) return cachedLibraryHostname;

  const fromVideo = hostnameFromVideoObject(video);
  if (fromVideo) {
    cachedLibraryHostname = fromVideo;
    return fromVideo;
  }

  const lib = await bunnyRequest('GET', `/library/${BUNNY_LIBRARY_ID}`);
  let hostname = pickHostnameFromObject(lib);

  const pullZoneId = lib.PullZoneId || lib.pullZoneId;
  if (!hostname && pullZoneId) {
    try {
      const pullZone = await accountApiGet(`/pullzone/${pullZoneId}`);
      hostname = pickHostnameFromObject(pullZone);
    } catch (err) {
      console.warn(`[bunny] pull zone lookup failed id=${pullZoneId}: ${err.message}`);
    }
  }

  if (!hostname) {
    try {
      const videoLibrary = await accountApiGet(`/videolibrary/${BUNNY_LIBRARY_ID}`);
      hostname = pickHostnameFromObject(videoLibrary);
      const libPullZoneId = videoLibrary.PullZoneId || videoLibrary.pullZoneId;
      if (!hostname && libPullZoneId) {
        const pullZone = await accountApiGet(`/pullzone/${libPullZoneId}`);
        hostname = pickHostnameFromObject(pullZone);
      }
    } catch (err) {
      console.warn(`[bunny] videolibrary lookup failed: ${err.message}`);
    }
  }

  if (!hostname) {
    throw new Error(
      'Bunny CDN hostname unknown — set BUNNY_CDN_HOSTNAME (e.g. vz-xxxxx.b-cdn.net) on the Media Bridge'
    );
  }
  cachedLibraryHostname = hostname;
  return hostname;
}

async function getVideo(bunnyGuid) {
  return bunnyRequest('GET', `/library/${BUNNY_LIBRARY_ID}/videos/${bunnyGuid}`);
}

async function listVideosByTitle(title) {
  const data = await bunnyRequest('GET', `/library/${BUNNY_LIBRARY_ID}/videos`, {
    params: { page: 1, itemsPerPage: 100, search: title },
  });
  const items = data.items || data.Items || [];
  return items.filter((v) => v && v.title === title);
}

async function findVideoByYoutubeId(youtubeVideoId) {
  const cachedGuid = youtubeGuidCache.get(youtubeVideoId);
  if (cachedGuid) {
    try {
      return await getVideo(cachedGuid);
    } catch {
      youtubeGuidCache.delete(youtubeVideoId);
    }
  }

  const title = youtubeTitle(youtubeVideoId);
  const matches = await listVideosByTitle(title);
  if (matches.length === 0) return null;

  const video = pickBestLibraryMatch(matches);
  if (video) youtubeGuidCache.set(youtubeVideoId, video.guid);
  return video;
}

async function removeFailedLibraryEntries(youtubeVideoId) {
  const title = youtubeTitle(youtubeVideoId);
  const matches = await listVideosByTitle(title);
  const failed = matches.filter((v) => isFailedStatus(v.status));
  for (const video of failed) {
    try {
      await deleteBunnyVideo(video.guid, { reason: `failed ingest ${youtubeVideoId}` });
      if (youtubeGuidCache.get(youtubeVideoId) === video.guid) {
        youtubeGuidCache.delete(youtubeVideoId);
      }
    } catch (err) {
      console.warn(`[bunny] could not delete failed guid=${video.guid}: ${err.message}`);
    }
  }
}

async function submitYoutubeFetch(youtubeVideoId, quality, progress) {
  const title = youtubeTitle(youtubeVideoId);
  const direct = await resolveDirectMediaUrl(youtubeVideoId, quality, progress);
  const fetchUrl = direct.url;

  if (progress) {
    progress.activeSource = 'bunny';
    progress.phase = 'ingest';
    progress.ingestResolver = direct.ingestResolver || progress.ingestResolver || null;
    progress.detail = `Submitting direct media URL to Bunny Stream (${direct.ingestResolver || 'source'})`;
    progress.retryAfterMs = BUNNY_TRANSCODE_POLL_MS;
  }

  console.log(
    `[bunny] POST fetch video=${youtubeVideoId} ingest=${direct.ingestResolver || '?'} url=${fetchUrl.slice(0, 96)}…`
  );

  await bunnyRequest('POST', `/library/${BUNNY_LIBRARY_ID}/videos/fetch`, {
    body: { url: fetchUrl, title },
  });

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 1500 : 2000);
    const found = await findVideoByYoutubeId(youtubeVideoId);
    if (found && !isFailedStatus(found.status)) {
      console.log(
        `[bunny] fetch accepted video=${youtubeVideoId} guid=${found.guid} status=${statusLabel(found.status)}`
      );
      return found;
    }
    if (found && isFailedStatus(found.status)) {
      console.warn(
        `[bunny] fetch created failed entry video=${youtubeVideoId} guid=${found.guid} — retrying lookup`
      );
    }
  }

  throw new Error(`Bunny fetch accepted but video ${youtubeVideoId} not visible in library yet`);
}

function buildPlaybackUrl(hostname, bunnyGuid, quality, { preferHls = true } = {}) {
  const base = `https://${hostname}/${bunnyGuid}`;
  if (preferHls) {
    return `${base}/playlist.m3u8`;
  }
  const height = parseInt(String(quality || '360p'), 10) || 360;
  return `${base}/play_${height}p.mp4`;
}

async function waitForTranscode(bunnyGuid, youtubeVideoId, progress) {
  const startedAt = Date.now();
  const deadline = startedAt + BUNNY_TRANSCODE_MAX_MS;

  while (Date.now() < deadline) {
    const video = await getVideo(bunnyGuid);
    const status = video.status;
    const encodeProgress = Number(video.encodeProgress) || 0;

    if (progress) {
      progress.activeSource = 'bunny';
      progress.phase = 'transcoding';
      progress.detail = `Bunny transcoding (${encodeProgress}%, ${statusLabel(status)})`;
      progress.retryAfterMs = BUNNY_TRANSCODE_POLL_MS;
      progress.bunnyGuid = bunnyGuid;
      progress.encodeProgress = encodeProgress;
    }

    if (isPlayableStatus(status)) {
      console.log(
        `[bunny] ready video=${youtubeVideoId} guid=${bunnyGuid} after ${Date.now() - startedAt}ms`
      );
      return video;
    }

    if (isFailedStatus(status)) {
      throw new Error(
        `Bunny transcoding failed for ${youtubeVideoId} (status=${statusLabel(status)})`
      );
    }

    await sleep(BUNNY_TRANSCODE_POLL_MS);
  }

  const err = new Error(
    `Bunny transcoding not finished after ${BUNNY_TRANSCODE_MAX_MS}ms for ${youtubeVideoId}`
  );
  err.fileNotReady = true;
  throw err;
}

async function getVideoPlayData(bunnyGuid) {
  return bunnyRequest('GET', `/library/${BUNNY_LIBRARY_ID}/videos/${bunnyGuid}/play`);
}

function absolutizeBunnyUrl(url, playData) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const host =
    hostnameFromUrl(playData?.thumbnailUrl) ||
    hostnameFromUrl(playData?.fallbackUrl) ||
    hostnameFromUrl(playData?.previewUrl) ||
    hostnameFromUrl(playData?.originalUrl) ||
    cachedLibraryHostname;
  if (!host) return null;
  if (trimmed.startsWith('/')) return `https://${host}${trimmed}`;
  return `https://${host}/${trimmed.replace(/^\/+/, '')}`;
}

async function resolvePlaybackUrl(video, quality) {
  const playData = await getVideoPlayData(video.guid);

  const playlistUrl = absolutizeBunnyUrl(playData.videoPlaylistUrl, playData);
  if (playlistUrl) {
    const host = hostnameFromUrl(playlistUrl);
    if (host) cachedLibraryHostname = host;
    return playlistUrl;
  }

  const fallbackUrl = absolutizeBunnyUrl(playData.fallbackUrl, playData);
  if (fallbackUrl && /\.m3u8(\?|$)/i.test(fallbackUrl)) {
    const host = hostnameFromUrl(fallbackUrl);
    if (host) cachedLibraryHostname = host;
    return fallbackUrl;
  }

  const hostname = await getLibraryHostname(video);
  return buildPlaybackUrl(hostname, video.guid, quality, { preferHls: true });
}

/**
 * Resolve a YouTube videoId to a Bunny Stream CDN playback URL (HLS).
 * Uses async-friendly polling internally; throws fileNotReady while transcoding.
 */
async function resolveVideoDownloadUrl(youtubeVideoId, requestedQuality = '360p', progress = null) {
  requireConfigured();
  const quality = normalizeStreamQuality(requestedQuality);

  if (progress) {
    progress.activeSource = 'bunny';
    progress.phase = 'lookup';
    progress.detail = 'Checking Bunny Stream library';
    progress.retryAfterMs = 3000;
  }

  let video = await findVideoByYoutubeId(youtubeVideoId);

  if (!video) {
    video = await submitYoutubeFetch(youtubeVideoId, quality, progress);
  } else if (isFailedStatus(video.status)) {
    console.warn(
      `[bunny] previous ingest failed video=${youtubeVideoId} guid=${video.guid} — re-fetching`
    );
    await removeFailedLibraryEntries(youtubeVideoId);
    youtubeGuidCache.delete(youtubeVideoId);
    video = await submitYoutubeFetch(youtubeVideoId, quality, progress);
  }

  if (!isPlayableStatus(video.status)) {
    video = await waitForTranscode(video.guid, youtubeVideoId, progress);
  }

  const url = await resolvePlaybackUrl(video, quality);

  console.log(
    `[bunny] playback video=${youtubeVideoId} guid=${video.guid} quality=${quality} url=${url.slice(0, 96)}…`
  );

  return {
    url,
    quality,
    mime: 'application/vnd.apple.mpegurl',
    format: 'hls',
    proxied: false,
    source: 'bunny',
    bunnyGuid: video.guid,
  };
}

async function getVideoInfo(youtubeVideoId) {
  if (!isConfigured()) {
    throw new Error('Bunny Stream is not configured');
  }
  const video = await findVideoByYoutubeId(youtubeVideoId);
  if (!video) {
    if (SOCIALKIT_CONFIGURED) {
      try {
        return await socialKit.getVideoInfo(youtubeVideoId);
      } catch (err) {
        console.warn(`[bunny] info fallback SocialKit failed video=${youtubeVideoId}: ${err.message}`);
      }
    }
    return {
      title: youtubeTitle(youtubeVideoId),
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }
  const hostname = await getLibraryHostname(video).catch(() => null);
  const thumb = hostname
    ? `https://${hostname}/${video.guid}/${video.thumbnailFileName || 'thumbnail.jpg'}`
    : null;
  return {
    title: video.title,
    lengthSeconds: video.length ? Number(video.length) : null,
    author: null,
    ownerChannelName: null,
    externalChannelId: null,
    thumbnail: thumb ? [{ url: thumb }] : [],
    isLiveContent: false,
    liveBroadcastDetails: { isLiveNow: false },
  };
}

module.exports = {
  BUNNY_LIBRARY_ID,
  isConfigured,
  isIngestResolverConfigured,
  SOCIALKIT_CONFIGURED,
  RAPIDAPI_CONFIGURED,
  resolveVideoDownloadUrl,
  getVideoInfo,
  findVideoByYoutubeId,
  getVideo,
  youtubeTitle,
};
