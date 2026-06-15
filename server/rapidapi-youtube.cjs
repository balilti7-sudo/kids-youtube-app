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
/** Fail-fast: max 2s per RapidAPI HTTP call (override via RAPIDAPI_REQUEST_TIMEOUT_MS). */
const RAPIDAPI_REQUEST_TIMEOUT_MS = Number(process.env.RAPIDAPI_REQUEST_TIMEOUT_MS || 2000);
const FILE_READY_MAX_MS = Number(process.env.RAPIDAPI_FILE_READY_MAX_MS || 120_000);
const FILE_READY_POLL_MS = Number(process.env.RAPIDAPI_FILE_READY_POLL_MS || 5_000);
/** Retries when RapidAPI/CDN says the file is still being prepared (HTTP 404 + message). */
const FILE_NOT_READY_MAX_ATTEMPTS = Number(process.env.RAPIDAPI_FILE_NOT_READY_MAX_RETRIES || 4);
const FILE_NOT_READY_WAIT_MS = Number(process.env.RAPIDAPI_FILE_NOT_READY_WAIT_MS || 12_000);
/** Optional query param for quality/info endpoints (default|url). */
const RAPIDAPI_RESPONSE_MODE = (process.env.RAPIDAPI_RESPONSE_MODE || '').trim();
const RESOLVER = 'RapidAPI';
const QUOTA_EXCEEDED_MESSAGE = '[RapidAPI] Quota exceeded (429). Plan upgrade required';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isQuotaExceededResponse(res) {
  if (!res) return false;
  if (res.status === 429) return true;
  const text = responseBodyText(res).toLowerCase();
  return text.includes('quota') || text.includes('exceeded');
}

function assertQuotaAvailable(res, label = 'request') {
  if (!isQuotaExceededResponse(res)) return;
  console.error(
    `[${RESOLVER}] Quota exceeded on ${label} HTTP ${res.status}: ${responseBodyText(res).slice(0, 300)}`
  );
  throw new Error(QUOTA_EXCEEDED_MESSAGE);
}

/**
 * Axios GET ? fail fast on quota (429); no retry loop.
 */
async function rapidApiGet(url, config = {}, { label = 'request' } = {}) {
  const params = config.params || {};
  const query = new URLSearchParams(params).toString();
  const fullUrl = query ? `${url}?${query}` : url;
  console.log(
    `[rapidapi] GET ${label} url=${fullUrl} params=${JSON.stringify(params)} timeout=${RAPIDAPI_REQUEST_TIMEOUT_MS}ms`
  );

  const res = await axios.get(url, {
    timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
    ...config,
    validateStatus: () => true,
  });

  assertQuotaAvailable(res, label);
  return res;
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

function rapidApiBodyPreview(data, maxLen = 1200) {
  if (data == null) return '(null)';
  if (typeof data === 'string') return data.slice(0, maxLen);
  try {
    return JSON.stringify(data).slice(0, maxLen);
  } catch {
    return String(data).slice(0, maxLen);
  }
}

function logRapidApiResponse(label, res, videoId, extra = {}) {
  const bodyType =
    res.data === null ? 'null' : Array.isArray(res.data) ? 'array' : typeof res.data;
  const keys =
    res.data && typeof res.data === 'object' && !Array.isArray(res.data)
      ? Object.keys(res.data).slice(0, 12).join(',')
      : '';
  const qualityCount = parseQualitiesFromResponse(res.data).length;
  console.log(
    `[rapidapi] ${label} video=${videoId} HTTP ${res.status} bodyType=${bodyType}` +
      (keys ? ` keys=${keys}` : '') +
      ` qualityCount=${qualityCount}` +
      (extra.source ? ` via=${extra.source}` : '') +
      ` body=${rapidApiBodyPreview(res.data)}`
  );
}

function parseQualitiesFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.availableQuality)) return data.availableQuality;
  if (Array.isArray(data.qualities)) return data.qualities;
  if (Array.isArray(data.qualityOptions)) return data.qualityOptions;
  if (Array.isArray(data.data)) return data.data;
  if (data.data && typeof data.data === 'object') {
    if (Array.isArray(data.data.availableQuality)) return data.data.availableQuality;
    if (Array.isArray(data.data.qualities)) return data.data.qualities;
  }
  return [];
}

async function unwrapResponseModeUrl(data) {
  if (!data || typeof data !== 'object' || !data.url) return data;
  const url = String(data.url).trim();
  if (!url.startsWith('http')) return data;
  const looksLikeWrapper =
    data.status === 'processed' ||
    /response is available using the `url` key/i.test(String(data.comment || ''));
  if (!looksLikeWrapper) return data;

  console.log(`[rapidapi] fetching response_mode url wrapper: ${url.slice(0, 120)}...`);
  const res = await axios.get(url, {
    timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });
  assertQuotaAvailable(res, 'response_mode url');
  console.log(
    `[rapidapi] response_mode url HTTP ${res.status} body=${rapidApiBodyPreview(res.data, 800)}`
  );
  return res.status < 400 ? res.data : data;
}

function isVideoQualityEntry(q) {
  if (!q || q.id == null) return false;
  if (q.type === 'audio') return false;
  if (q.type === 'video') return true;
  const mime = String(q.mime || '');
  if (/^audio\//i.test(mime)) return false;
  if (/^video\//i.test(mime)) return true;
  if (q.quality && /\d+\s*p/i.test(String(q.quality))) return true;
  return q.type == null;
}

function pickVideoQualityId(qualities, targetQuality = null) {
  const videos = (Array.isArray(qualities) ? qualities : []).filter(isVideoQualityEntry);
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

function qualityEndpointParams() {
  if (!RAPIDAPI_RESPONSE_MODE) return {};
  return { response_mode: RAPIDAPI_RESPONSE_MODE };
}

async function fetchQualitiesFromPath(videoId, pathLabel, pathSuffix) {
  const res = await rapidApiGet(
    `${RAPIDAPI_BASE}/${pathSuffix}/${videoId}`,
    {
      headers: rapidHeaders(),
      params: qualityEndpointParams(),
    },
    { label: `${pathLabel}/${videoId}` }
  );
  logRapidApiResponse(pathLabel, res, videoId);
  if (res.status >= 400) {
    return { qualities: [], ok: false, status: res.status, detail: responseBodyText(res).slice(0, 300) };
  }
  const unwrapped = await unwrapResponseModeUrl(res.data);
  const qualities = parseQualitiesFromResponse(unwrapped);
  return { qualities, ok: true, status: res.status, raw: unwrapped };
}

async function getAvailableQualities(videoId) {
  const primary = await fetchQualitiesFromPath(
    videoId,
    'get_available_quality',
    'get_available_quality'
  );

  if (primary.qualities.length > 0) {
    console.log(
      `[rapidapi] using ${primary.qualities.length} qualities from get_available_quality video=${videoId}`
    );
    return { qualities: primary.qualities, source: 'get_available_quality', isShortHint: false };
  }

  if (!primary.ok) {
    console.warn(
      `[rapidapi] get_available_quality failed video=${videoId} HTTP ${primary.status}: ${primary.detail || ''}`
    );
  } else {
    console.warn(
      `[rapidapi] get_available_quality returned empty list video=${videoId} ? trying get-video-info`
    );
  }

  const infoRes = await rapidApiGet(
    `${RAPIDAPI_BASE}/get-video-info/${videoId}`,
    {
      headers: rapidHeaders(),
      params: qualityEndpointParams(),
    },
    { label: `get-video-info/${videoId}` }
  );
  logRapidApiResponse('get-video-info', infoRes, videoId);

  let isShortHint = false;
  if (infoRes.status < 400 && infoRes.data && typeof infoRes.data === 'object') {
    const info = await unwrapResponseModeUrl(infoRes.data);
    const title = String(info.title || '').toLowerCase();
    const duration = Number(info.lengthSeconds || 0);
    isShortHint = duration > 0 && duration <= 65;
    if (/short/i.test(title)) isShortHint = true;
    const fromInfo = parseQualitiesFromResponse(info);
    if (fromInfo.length > 0) {
      console.log(
        `[rapidapi] using ${fromInfo.length} qualities from get-video-info.availableQuality video=${videoId}`
      );
      return { qualities: fromInfo, source: 'get-video-info', isShortHint };
    }
    console.warn(
      `[rapidapi] get-video-info had no availableQuality video=${videoId} ` +
        `title=${JSON.stringify(info.title || '').slice(0, 80)} duration=${info.lengthSeconds || '?'}`
    );
  } else if (infoRes.status >= 400) {
    console.warn(
      `[rapidapi] get-video-info failed video=${videoId} HTTP ${infoRes.status}: ${responseBodyText(infoRes).slice(0, 300)}`
    );
  }

  return { qualities: [], source: 'none', isShortHint };
}

async function requestDownloadMeta(videoId, qualityId, downloadKind = 'video') {
  const path = downloadKind === 'short' ? 'download_short' : 'download_video';
  let lastDetail = '';

  for (let attempt = 1; attempt <= FILE_NOT_READY_MAX_ATTEMPTS; attempt++) {
    const res = await rapidApiGet(
      `${RAPIDAPI_BASE}/${path}/${videoId}`,
      {
        params: { quality: qualityId },
        headers: rapidHeaders(),
      },
      { label: `${path}/${videoId}` }
    );

    if (res.status >= 400) {
      lastDetail = responseBodyText(res).slice(0, 200);
      logRapidApiResponse(path, res, videoId);

      if (isFileNotReadyHttpResponse(res) && attempt < FILE_NOT_READY_MAX_ATTEMPTS) {
        console.warn(
          `[rapidapi] ${path} file not ready video=${videoId} ` +
            `attempt=${attempt}/${FILE_NOT_READY_MAX_ATTEMPTS} HTTP ${res.status} ? ` +
            `retry in ${FILE_NOT_READY_WAIT_MS}ms (${lastDetail || 'no body'})`
        );
        await sleep(FILE_NOT_READY_WAIT_MS);
        continue;
      }

      const err = new Error(`RapidAPI ${path} HTTP ${res.status}: ${lastDetail}`);
      err.downloadKind = downloadKind;
      throw err;
    }

    logRapidApiResponse(path, res, videoId, { source: 'download-meta' });

    const file = res.data && res.data.file;
    if (!file || typeof file !== 'string') {
      lastDetail = 'response missing file URL';
      if (attempt < FILE_NOT_READY_MAX_ATTEMPTS) {
        console.warn(
          `[rapidapi] ${path} missing file URL video=${videoId} ` +
            `attempt=${attempt}/${FILE_NOT_READY_MAX_ATTEMPTS} ? retry in ${FILE_NOT_READY_WAIT_MS}ms`
        );
        await sleep(FILE_NOT_READY_WAIT_MS);
        continue;
      }
      throw new Error(`RapidAPI ${path} response missing file URL`);
    }

    if (attempt > 1) {
      console.log(
        `[rapidapi] ${path} ready video=${videoId} after ${attempt} attempts`
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
    `RapidAPI ${path} file not ready after ${FILE_NOT_READY_MAX_ATTEMPTS} attempts: ${lastDetail}`
  );
}

async function requestDownloadMetaWithFallback(videoId, qualityId, isShortHint = false) {
  const order = isShortHint
    ? ['short', 'video']
    : ['video', 'short'];

  let lastErr = null;
  for (const kind of order) {
    try {
      return await requestDownloadMeta(videoId, qualityId, kind);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[rapidapi] ${kind === 'short' ? 'download_short' : 'download_video'} failed ` +
          `video=${videoId} qualityId=${qualityId}: ${err.message}`
      );
    }
  }
  throw lastErr || new Error('RapidAPI download failed');
}

async function probeFileUrl(fileUrl) {
  try {
    const head = await axios.head(fileUrl, {
      timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    assertQuotaAvailable(head, 'cdn HEAD probe');
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
        timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: () => true,
      });
      assertQuotaAvailable(head, 'cdn HEAD wait');
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
  const { qualities, source, isShortHint } = await getAvailableQualities(videoId);

  console.log(
    `[rapidapi] resolve video=${videoId} target=${targetQuality} qualitySource=${source} ` +
      `count=${qualities.length} shortHint=${isShortHint}`
  );

  if (qualities.length > 0) {
    console.log(
      `[rapidapi] quality options video=${videoId}: ` +
        qualities
          .slice(0, 8)
          .map((q) => `id=${q.id} q=${q.quality || '?'} type=${q.type || '?'} mime=${String(q.mime || '').slice(0, 24)}`)
          .join(' | ')
    );
  }

  let qualityId = pickVideoQualityId(qualities, targetQuality);

  if (!qualityId && DEFAULT_QUALITY) {
    qualityId = DEFAULT_QUALITY;
    console.log(`[rapidapi] using RAPIDAPI_YOUTUBE_QUALITY=${qualityId} video=${videoId}`);
  }

  if (!qualityId) {
    throw new Error(
      `No suitable RapidAPI video quality found for ${videoId} ` +
        `(qualitySource=${source}, listed=${qualities.length}, target=${targetQuality})`
    );
  }

  console.log(`[rapidapi] picked qualityId=${qualityId} for video=${videoId} target=${targetQuality}`);

  const meta = await requestDownloadMetaWithFallback(videoId, qualityId, isShortHint);
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
    { headers: rapidHeaders() },
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
  parseQualitiesFromResponse,
  getAvailableQualities,
  waitForFileReady,
  probeFileUrl,
};
