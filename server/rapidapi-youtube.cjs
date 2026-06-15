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
const RAPIDAPI_REQUEST_TIMEOUT_MS = Number(process.env.RAPIDAPI_REQUEST_TIMEOUT_MS || 60_000);
const FILE_READY_MAX_MS = Number(process.env.RAPIDAPI_FILE_READY_MAX_MS || 120_000);
const FILE_READY_POLL_MS = Number(process.env.RAPIDAPI_FILE_READY_POLL_MS || 5_000);
const RAPIDAPI_429_MAX_RETRIES = Number(process.env.RAPIDAPI_429_MAX_RETRIES || 4);
const RAPIDAPI_429_BASE_MS = Number(process.env.RAPIDAPI_429_BASE_MS || 2_000);
/** Retries when RapidAPI/CDN says the file is still being prepared (HTTP 404 + message). */
const FILE_NOT_READY_MAX_ATTEMPTS = Number(process.env.RAPIDAPI_FILE_NOT_READY_MAX_RETRIES || 4);
const FILE_NOT_READY_WAIT_MS = Number(process.env.RAPIDAPI_FILE_NOT_READY_WAIT_MS || 12_000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Axios GET with exponential backoff on RapidAPI HTTP 429 (rate limit).
 */
async function rapidApiGet(url, config = {}, { label = 'request' } = {}) {
  let lastRes = null;

  for (let attempt = 0; attempt <= RAPIDAPI_429_MAX_RETRIES; attempt++) {
    const params = config.params || {};
    const query = new URLSearchParams(params).toString();
    const fullUrl = query ? `${url}?${query}` : url;
    console.log(
      `[rapidapi] GET ${label} attempt=${attempt + 1} url=${fullUrl} params=${JSON.stringify(params)}`
    );

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
        `[rapidapi] ${label} HTTP 429 ? retry ${attempt + 1}/${RAPIDAPI_429_MAX_RETRIES} in ${delayMs}ms`
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
function responseBodyText(res) {
  if (typeof res.data === 'string') return res.data;
  if (res.data && typeof res.data === 'object') {
    try {
      return JSON.stringify(res.data);
    } catch {
      return String(res.data);
    }
  }
  return '';
}

/** RapidAPI often returns 404 (or 524 timeout) while the CDN file is still processing. */
function isFileNotReadyHttpResponse(res) {
  const detail = responseBodyText(res).toLowerCase();
  if (/file not ready|not ready|still processing|processing|try again/i.test(detail)) return true;
  if (res.status === 524) return true;
  return false;
}

function pickVideoQualityId(qualities, targetQuality = null) {
  const videos = (Array.isArray(qualities) ? qualities : []).filter(
    (q) => q && q.type === 'video' && q.id != null
  );
  if (videos.length === 0) return null;

  const mp4 = videos.filter((q) => /mp4/i.test(String(q.mime || '')));
  const pool = mp4.length > 0 ? mp4 : videos;

  const targetHeight = parseHeight(targetQuality);
  const maxHeight = targetHeight > 0 ? targetHeight : 720;

  const capped = pool.filter((q) => {
    const h = parseHeight(q.quality);
    if (h === 0) return true;
    return h <= maxHeight;
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
    { headers: rapidHeaders(), timeout: RAPIDAPI_REQUEST_TIMEOUT_MS },
    { label: `get_available_quality/${videoId}` }
  );

  if (res.status >= 400) {
    throw new Error(`RapidAPI get_available_quality HTTP ${res.status}`);
  }

  return Array.isArray(res.data) ? res.data : [];
}

async function requestDownloadMeta(videoId, qualityId) {
  let lastDetail = '';

  for (let attempt = 1; attempt <= FILE_NOT_READY_MAX_ATTEMPTS; attempt++) {
    const res = await rapidApiGet(
      `${RAPIDAPI_BASE}/download_video/${videoId}`,
      {
        params: { quality: qualityId },
        headers: rapidHeaders(),
        timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
      },
      { label: `download_video/${videoId}` }
    );

    if (res.status >= 400) {
      lastDetail = responseBodyText(res).slice(0, 200);

      if (isFileNotReadyHttpResponse(res) && attempt < FILE_NOT_READY_MAX_ATTEMPTS) {
        console.warn(
          `[rapidapi] download_video file not ready video=${videoId} ` +
            `attempt=${attempt}/${FILE_NOT_READY_MAX_ATTEMPTS} HTTP ${res.status} ? ` +
            `retry in ${FILE_NOT_READY_WAIT_MS}ms (${lastDetail || 'no body'})`
        );
        await sleep(FILE_NOT_READY_WAIT_MS);
        continue;
      }

      throw new Error(`RapidAPI download_video HTTP ${res.status}: ${lastDetail}`);
    }

    const file = res.data && res.data.file;
    if (!file || typeof file !== 'string') {
      lastDetail = 'response missing file URL';
      if (attempt < FILE_NOT_READY_MAX_ATTEMPTS) {
        console.warn(
          `[rapidapi] download_video missing file URL video=${videoId} ` +
            `attempt=${attempt}/${FILE_NOT_READY_MAX_ATTEMPTS} ? retry in ${FILE_NOT_READY_WAIT_MS}ms`
        );
        await sleep(FILE_NOT_READY_WAIT_MS);
        continue;
      }
      throw new Error('RapidAPI download_video response missing file URL');
    }

    if (attempt > 1) {
      console.log(
        `[rapidapi] download_video ready video=${videoId} after ${attempt} attempts`
      );
    }

    return {
      file,
      quality: res.data.quality || null,
      mime: res.data.mime || 'video/mp4',
      id: res.data.id,
    };
  }

  throw new Error(
    `RapidAPI download_video file not ready after ${FILE_NOT_READY_MAX_ATTEMPTS} attempts: ${lastDetail}`
  );
}

async function probeFileUrl(fileUrl) {
  try {
    const head = await axios.head(fileUrl, {
      timeout: 12_000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    return head.status || 0;
  } catch (err) {
    console.warn(`[rapidapi] file HEAD probe error: ${err.message}`);
    return 0;
  }
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
          `? retry in ${FILE_READY_POLL_MS}ms`
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
    'The CDN file may still be processing ? retry in 15?30 seconds.';
  console.error(
    `[rapidapi] ${msg} video=${videoId || '?'} url=${String(fileUrl).slice(0, 96)}?`
  );
  throw new Error(msg);
}

/**
 * Resolve a direct playable URL for a YouTube videoId via RapidAPI.
 * @returns {Promise<{ url: string, quality: string|null, mime: string }>}
 */
async function resolveVideoDownloadUrl(videoId, requestedQuality = '360p') {
  const targetQuality = normalizeStreamQuality(requestedQuality);
  const qualities = await getAvailableQualities(videoId);
  let qualityId = pickVideoQualityId(qualities, targetQuality);

  if (!qualityId && DEFAULT_QUALITY) {
    qualityId = DEFAULT_QUALITY;
  }

  if (!qualityId) {
    throw new Error('No suitable RapidAPI video quality found');
  }

  const meta = await requestDownloadMeta(videoId, qualityId);
  const cdnStatus = await probeFileUrl(meta.file);

  if (cdnStatus === 200) {
    console.log(`[rapidapi] CDN ready video=${videoId} quality=${targetQuality} HTTP 200`);
  } else {
    console.log(
      `[rapidapi] CDN not ready video=${videoId} quality=${targetQuality} ` +
        `HTTP ${cdnStatus || 'error'} ? waiting up to ${FILE_READY_MAX_MS}ms`
    );
    await waitForFileReady(meta.file, { videoId });
  }

  return {
    url: meta.file,
    quality: meta.quality || targetQuality,
    mime: meta.mime,
  };
}

function normalizeStreamQuality(raw, fallback = '360p') {
  const allowed = new Set(['240p', '360p', '480p', '720p', '1080p']);
  const q = String(raw || fallback).trim().toLowerCase();
  return allowed.has(q) ? q : fallback;
}

async function getVideoInfo(videoId) {
  const res = await rapidApiGet(
    `${RAPIDAPI_BASE}/get-video-info/${videoId}`,
    { headers: rapidHeaders(), timeout: RAPIDAPI_REQUEST_TIMEOUT_MS },
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
  waitForFileReady,
  probeFileUrl,
};
