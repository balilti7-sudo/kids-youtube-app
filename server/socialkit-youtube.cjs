'use strict';

const axios = require('axios');

const SOCIALKIT_BASE = (process.env.SOCIALKIT_API_BASE || 'https://api.socialkit.dev').replace(/\/+$/, '');
const SOCIALKIT_ACCESS_KEY = (
  process.env.SOCIALKIT_ACCESS_KEY ||
  process.env.SOCIALKIT_API_KEY ||
  ''
).trim();

const DEFAULT_FORMAT = (process.env.SOCIALKIT_FORMAT || 'mp4').trim().toLowerCase();
const DEFAULT_QUALITY = (process.env.SOCIALKIT_QUALITY || '360p').trim().toLowerCase();
const REQUEST_TIMEOUT_MS = Number(process.env.SOCIALKIT_REQUEST_TIMEOUT_MS || 90_000);

function requireApiKey() {
  if (!SOCIALKIT_ACCESS_KEY) {
    throw new Error('SOCIALKIT_ACCESS_KEY is not set on the Media Bridge');
  }
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function parseDurationSeconds(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const parts = String(raw)
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function channelIdFromLink(channelLink) {
  if (!channelLink || typeof channelLink !== 'string') return null;
  const m = channelLink.match(/\/channel\/([^/?#]+)/i);
  return m ? m[1] : null;
}

function socialKitErrorMessage(res) {
  const body = res?.data;
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 200);
  return `HTTP ${res?.status ?? 'unknown'}`;
}

function mimeForFormat(format) {
  const f = String(format || DEFAULT_FORMAT).toLowerCase();
  if (f === 'mp4') return 'video/mp4';
  if (f === 'webm') return 'video/webm';
  if (f === 'avi') return 'video/x-msvideo';
  if (f === 'mp3') return 'audio/mpeg';
  if (f === 'm4a') return 'audio/mp4';
  if (f === 'ogg') return 'audio/ogg';
  if (f === 'wav') return 'audio/wav';
  return 'video/mp4';
}

/**
 * Resolve a direct playable URL for a YouTube videoId via SocialKit.
 * @returns {Promise<{ url: string, quality: string|null, mime: string }>}
 */
async function resolveVideoDownloadUrl(videoId) {
  requireApiKey();

  const watchUrl = youtubeWatchUrl(videoId);
  console.log(
    `[socialkit] POST /youtube/download video=${videoId} format=${DEFAULT_FORMAT} quality=${DEFAULT_QUALITY}`
  );

  const res = await axios.post(
    `${SOCIALKIT_BASE}/youtube/download`,
    {
      access_key: SOCIALKIT_ACCESS_KEY,
      url: watchUrl,
      format: DEFAULT_FORMAT,
      quality: DEFAULT_QUALITY,
    },
    {
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { accept: 'application/json', 'Content-Type': 'application/json' },
    }
  );

  if (res.status >= 400 || res.data?.success === false) {
    throw new Error(`SocialKit download failed: ${socialKitErrorMessage(res)}`);
  }

  const data = res.data?.data;
  const downloadUrl = data?.downloadUrl;
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new Error('SocialKit download response missing downloadUrl');
  }

  console.log(
    `[socialkit] download ready video=${videoId} quality=${data.quality || DEFAULT_QUALITY} ` +
      `size=${data.fileSizeMB || '?'} url=${downloadUrl.slice(0, 96)}…`
  );

  return {
    url: downloadUrl,
    quality: data.quality || DEFAULT_QUALITY,
    mime: mimeForFormat(data.format || DEFAULT_FORMAT),
  };
}

/** Metadata for `/api/info/:videoId` via SocialKit stats (no download). */
async function getVideoInfo(videoId) {
  requireApiKey();

  const watchUrl = youtubeWatchUrl(videoId);
  console.log(`[socialkit] GET /youtube/stats video=${videoId}`);

  const res = await axios.get(`${SOCIALKIT_BASE}/youtube/stats`, {
    params: {
      access_key: SOCIALKIT_ACCESS_KEY,
      url: watchUrl,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
    headers: { accept: 'application/json' },
  });

  if (res.status >= 400 || res.data?.success === false) {
    throw new Error(`SocialKit stats failed: ${socialKitErrorMessage(res)}`);
  }

  const data = res.data?.data || {};
  const durationSeconds =
    parseDurationSeconds(data.duration) ?? parseDurationSeconds(data.durationSeconds);

  return {
    title: data.title || null,
    lengthSeconds: durationSeconds,
    author: data.channelName || null,
    ownerChannelName: data.channelName || null,
    externalChannelId: channelIdFromLink(data.channelLink),
    thumbnail: data.thumbnailUrl ? [{ url: data.thumbnailUrl }] : [],
    isLiveContent: false,
    liveBroadcastDetails: { isLiveNow: false },
    isShortForm: Boolean(data.isShortForm),
    contentType: data.contentType || null,
  };
}

module.exports = {
  SOCIALKIT_BASE,
  resolveVideoDownloadUrl,
  getVideoInfo,
};
