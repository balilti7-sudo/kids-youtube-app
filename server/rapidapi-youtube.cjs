'use strict';

const axios = require('axios');

const RAPIDAPI_HOST =
  (process.env.RAPIDAPI_YOUTUBE_HOST || 'youtube-video-fast-downloader-24-7.p.rapidapi.com').trim();
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;
const RAPIDAPI_KEY = (
  process.env.RAPIDAPI_KEY ||
  process.env.RAPIDAPI_YOUTUBE_KEY ||
  ''
).trim();

const DEFAULT_QUALITY = (process.env.RAPIDAPI_YOUTUBE_QUALITY || '').trim();
const FILE_READY_MAX_MS = Number(process.env.RAPIDAPI_FILE_READY_MAX_MS || 60_000);
const FILE_READY_POLL_MS = Number(process.env.RAPIDAPI_FILE_READY_POLL_MS || 5_000);
const RAPIDAPI_429_MAX_RETRIES = Number(process.env.RAPIDAPI_429_MAX_RETRIES || 4);
const RAPIDAPI_429_BASE_MS = Number(process.env.RAPIDAPI_429_BASE_MS || 2_000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Axios GET with exponential backoff on RapidAPI HTTP 429 (rate limit).
 */
async function rapidApiGet(url, config = {}, { label = 'request' } = {}) {
  let lastRes = null;

  for (let attempt = 0; attempt <= RAPIDAPI_429_MAX_RETRIES; attempt++) {
    const res = await axios.get(url, {
      ...config,
      validateStatus: () => true,
    });
    lastRes = res;

    if (res.status === 429) {
      if (attempt >= RAPIDAPI_429_MAX_RETRIES) {
        const detail =
          typeof res.data === 'string'
            ? res.data.slice(0, 200)
            : JSON.stringify(res.data || {}).slice(0, 200);
        throw new Error(
          `RapidAPI ${label} HTTP 429 after ${attempt + 1} attempts (rate limited): ${detail}`
        );
      }
      const delayMs = RAPIDAPI_429_BASE_MS * 2 ** attempt;
      console.warn(
        `[rapidapi] ${label} HTTP 429 — retry ${attempt + 1}/${RAPIDAPI_429_MAX_RETRIES} in ${delayMs}ms`
      );
      await sleep(delayMs);
      continue;
    }

    return res;
  }

  return lastRes;
}

function requireApiKey() {
  if (!RAPIDAPI_KEY) {
    throw new Error('RAPIDAPI_KEY is not set on the Media Bridge');
  }
}

function rapidHeaders() {
  requireApiKey();
  return {
    'x-rapidapi-key': RAPIDAPI_KEY,
    'x-rapidapi-host': RAPIDAPI_HOST,
  };
}

function parseHeight(quality) {
  const m = String(quality || '').match(/(\d+)\s*p/i);
  return m ? Number(m[1]) : 0;
}

/** Pick a muxed-friendly video quality id (prefer MP4, max 720p). */
function pickVideoQualityId(qualities) {
  const videos = (Array.isArray(qualities) ? qualities : []).filter(
    (q) => q && q.type === 'video' && q.id != null
  );
  if (videos.length === 0) return null;

  const mp4 = videos.filter((q) => /mp4/i.test(String(q.mime || '')));
  const pool = mp4.length > 0 ? mp4 : videos;

  const capped = pool.filter((q) => {
    const h = parseHeight(q.quality);
    return h === 0 || h <= 720;
  });
  const ranked = (capped.length > 0 ? capped : pool).sort((a, b) => {
    const ah = parseHeight(a.quality);
    const bh = parseHeight(b.quality);
    return bh - ah;
  });

  return ranked[0]?.id ?? null;
}

async function getAvailableQualities(videoId) {
  const res = await rapidApiGet(
    `${RAPIDAPI_BASE}/get_available_quality/${videoId}`,
    { headers: rapidHeaders(), timeout: 30_000 },
    { label: `get_available_quality/${videoId}` }
  );

  if (res.status >= 400) {
    throw new Error(`RapidAPI get_available_quality HTTP ${res.status}`);
  }

  return Array.isArray(res.data) ? res.data : [];
}

async function requestDownloadMeta(videoId, qualityId) {
  const res = await rapidApiGet(
    `${RAPIDAPI_BASE}/download_video/${videoId}`,
    {
      params: { quality: qualityId },
      headers: rapidHeaders(),
      timeout: 60_000,
    },
    { label: `download_video/${videoId}` }
  );

  if (res.status >= 400) {
    const detail =
      typeof res.data === 'string'
        ? res.data.slice(0, 200)
        : JSON.stringify(res.data || {}).slice(0, 200);
    throw new Error(`RapidAPI download_video HTTP ${res.status}: ${detail}`);
  }

  const file = res.data && res.data.file;
  if (!file || typeof file !== 'string') {
    throw new Error('RapidAPI download_video response missing file URL');
  }

  return {
    file,
    quality: res.data.quality || null,
    mime: res.data.mime || 'video/mp4',
    id: res.data.id,
  };
}

async function waitForFileReady(fileUrl, { videoId = '' } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + FILE_READY_MAX_MS;
  let lastStatus = null;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const head = await axios.head(fileUrl, {
        timeout: 12_000,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      lastStatus = head.status;
      if (head.status === 200) {
        console.log(
          `[rapidapi] file ready video=${videoId || '?'} after ${Date.now() - startedAt}ms ` +
            `(attempt ${attempts})`
        );
        return;
      }
      console.warn(
        `[rapidapi] file not ready video=${videoId || '?'} attempt=${attempts} HTTP ${head.status} ` +
          `— retry in ${FILE_READY_POLL_MS}ms`
      );
    } catch (err) {
      lastStatus = err.message;
      console.warn(
        `[rapidapi] file HEAD error video=${videoId || '?'} attempt=${attempts}: ${err.message}`
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(FILE_READY_POLL_MS, remaining)));
  }

  const waitedMs = Date.now() - startedAt;
  const msg =
    `RapidAPI file URL not ready after ${waitedMs}ms (limit ${FILE_READY_MAX_MS}ms, ` +
    `${attempts} attempts, lastStatus=${lastStatus ?? 'unknown'}). ` +
    'The CDN file may still be processing — retry in 15–30 seconds.';
  console.error(
    `[rapidapi] ${msg} video=${videoId || '?'} url=${String(fileUrl).slice(0, 96)}…`
  );
  throw new Error(msg);
}

/**
 * Resolve a direct playable URL for a YouTube videoId via RapidAPI.
 * @returns {Promise<{ url: string, quality: string|null, mime: string }>}
 */
async function resolveVideoDownloadUrl(videoId) {
  let qualityId = DEFAULT_QUALITY;

  if (!qualityId) {
    const qualities = await getAvailableQualities(videoId);
    qualityId = pickVideoQualityId(qualities);
  }

  if (!qualityId) {
    throw new Error('No suitable RapidAPI video quality found');
  }

  const meta = await requestDownloadMeta(videoId, qualityId);
  await waitForFileReady(meta.file, { videoId });

  return {
    url: meta.file,
    quality: meta.quality,
    mime: meta.mime,
  };
}

async function getVideoInfo(videoId) {
  const res = await rapidApiGet(
    `${RAPIDAPI_BASE}/get-video-info/${videoId}`,
    { headers: rapidHeaders(), timeout: 30_000 },
    { label: `get-video-info/${videoId}` }
  );

  if (res.status >= 400) {
    throw new Error(`RapidAPI get-video-info HTTP ${res.status}`);
  }

  return res.data || {};
}

module.exports = {
  RAPIDAPI_HOST,
  resolveVideoDownloadUrl,
  getVideoInfo,
  pickVideoQualityId,
};
