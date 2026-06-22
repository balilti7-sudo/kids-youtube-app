'use strict';

const axios = require('axios');

const BUNNY_API_BASE = 'https://video.bunnycdn.com';
const BUNNY_STREAM_API_KEY = (process.env.BUNNY_STREAM_API_KEY || '').trim();
const BUNNY_LIBRARY_ID = (process.env.BUNNY_LIBRARY_ID || '').trim();
const BUNNY_CDN_HOSTNAME = (process.env.BUNNY_CDN_HOSTNAME || '').trim();
const BUNNY_REQUEST_TIMEOUT_MS = Number(process.env.BUNNY_REQUEST_TIMEOUT_MS || 30_000);
const BUNNY_TRANSCODE_POLL_MS = Number(process.env.BUNNY_TRANSCODE_POLL_MS || 4_000);
const BUNNY_TRANSCODE_MAX_MS = Number(process.env.BUNNY_TRANSCODE_MAX_MS || 600_000);

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

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
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

async function getLibraryHostname() {
  if (BUNNY_CDN_HOSTNAME) {
    return BUNNY_CDN_HOSTNAME.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
  if (cachedLibraryHostname) return cachedLibraryHostname;

  const lib = await bunnyRequest('GET', `/library/${BUNNY_LIBRARY_ID}`);
  const hostname =
    lib.cdnHostname ||
    lib.CdnHostname ||
    lib.hostname ||
    lib.Hostname ||
    lib.PullZoneUrl ||
    '';
  if (!hostname) {
    throw new Error(
      'Bunny CDN hostname unknown — set BUNNY_CDN_HOSTNAME (e.g. vz-xxxxx.b-cdn.net) on the Media Bridge'
    );
  }
  cachedLibraryHostname = String(hostname).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return cachedLibraryHostname;
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

  const video = matches[0];
  youtubeGuidCache.set(youtubeVideoId, video.guid);
  return video;
}

async function submitYoutubeFetch(youtubeVideoId, progress) {
  const title = youtubeTitle(youtubeVideoId);
  const watchUrl = youtubeWatchUrl(youtubeVideoId);

  if (progress) {
    progress.activeSource = 'bunny';
    progress.phase = 'ingest';
    progress.detail = 'Submitting YouTube URL to Bunny Stream for fetch & transcode';
    progress.retryAfterMs = BUNNY_TRANSCODE_POLL_MS;
  }

  console.log(`[bunny] POST fetch video=${youtubeVideoId} url=${watchUrl}`);

  await bunnyRequest('POST', `/library/${BUNNY_LIBRARY_ID}/videos/fetch`, {
    body: { url: watchUrl, title },
  });

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 1500 : 2000);
    const found = await findVideoByYoutubeId(youtubeVideoId);
    if (found) {
      console.log(
        `[bunny] fetch accepted video=${youtubeVideoId} guid=${found.guid} status=${statusLabel(found.status)}`
      );
      return found;
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
    video = await submitYoutubeFetch(youtubeVideoId, progress);
  } else if (isFailedStatus(video.status)) {
    console.warn(
      `[bunny] previous ingest failed video=${youtubeVideoId} guid=${video.guid} — re-fetching`
    );
    youtubeGuidCache.delete(youtubeVideoId);
    video = await submitYoutubeFetch(youtubeVideoId, progress);
  }

  if (!isPlayableStatus(video.status)) {
    video = await waitForTranscode(video.guid, youtubeVideoId, progress);
  }

  const hostname = await getLibraryHostname();
  const url = buildPlaybackUrl(hostname, video.guid, quality, { preferHls: true });

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
    return {
      title: youtubeTitle(youtubeVideoId),
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }
  const hostname = await getLibraryHostname().catch(() => null);
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
  resolveVideoDownloadUrl,
  getVideoInfo,
  findVideoByYoutubeId,
  getVideo,
  youtubeTitle,
};
