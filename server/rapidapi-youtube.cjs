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
/** Per RapidAPI HTTP call (override via RAPIDAPI_REQUEST_TIMEOUT_MS). Long downloads need ?30s. */
const RAPIDAPI_REQUEST_TIMEOUT_MS = Number(process.env.RAPIDAPI_REQUEST_TIMEOUT_MS || 30_000);
const FILE_READY_MAX_MS = Number(process.env.RAPIDAPI_FILE_READY_MAX_MS || 120_000);
const FILE_READY_POLL_MS = Number(process.env.RAPIDAPI_FILE_READY_POLL_MS || 3_000);
const FILE_READY_MAX_MS_LONG = Number(process.env.RAPIDAPI_FILE_READY_MAX_MS_LONG || 180_000);
const FILE_READY_POLL_MS_LONG = Number(process.env.RAPIDAPI_FILE_READY_POLL_MS_LONG || 3_000);
/** Polling when RapidAPI/CDN says the file is still being prepared. */
const DOWNLOAD_POLL_MAX_ATTEMPTS = Number(process.env.RAPIDAPI_DOWNLOAD_POLL_MAX_ATTEMPTS || 5);
const DOWNLOAD_POLL_MAX_ATTEMPTS_LONG = Number(
  process.env.RAPIDAPI_DOWNLOAD_POLL_MAX_ATTEMPTS_LONG || 12
);
const DOWNLOAD_POLL_WAIT_MS = Number(process.env.RAPIDAPI_FILE_NOT_READY_WAIT_MS || 12_000);
const DOWNLOAD_POLL_WAIT_MS_LONG = Number(process.env.RAPIDAPI_FILE_NOT_READY_WAIT_MS_LONG || 8_000);
const CDN_PROBE_TIMEOUT_MS = Number(process.env.RAPIDAPI_CDN_PROBE_TIMEOUT_MS || 8000);
/** YouTube Shorts are typically <= 65s; longer videos need stricter CDN readiness checks. */
const SHORT_VIDEO_MAX_DURATION_SEC = Number(process.env.RAPIDAPI_SHORT_MAX_DURATION_SEC || 65);
/** Rough minimum bytes/sec for 360p ? used to detect partial CDN files on long videos. */
const MIN_BYTES_PER_SECOND_360P = Number(process.env.RAPIDAPI_MIN_BYTES_PER_SECOND || 10_000);
/** Optional query param for quality/info endpoints (default|url). */
const RAPIDAPI_RESPONSE_MODE = (process.env.RAPIDAPI_RESPONSE_MODE || '').trim();
const RESOLVER = 'RapidAPI';
const QUOTA_EXCEEDED_MESSAGE = '[RapidAPI] Quota exceeded (429). Plan upgrade required';

if (RAPIDAPI_REQUEST_TIMEOUT_MS < 15_000) {
  console.warn(
    `[rapidapi] RAPIDAPI_REQUEST_TIMEOUT_MS=${RAPIDAPI_REQUEST_TIMEOUT_MS} is low ? ` +
      'long video downloads often need ?30s. Set RAPIDAPI_REQUEST_TIMEOUT_MS=30000 on Render.'
  );
}

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

function logRapidApiAxiosError(err, label = 'request') {
  if (err?.response) {
    console.error(
      `[rapidapi] ${label} axios error response.status=${err.response.status} ` +
        `response.data=${rapidApiBodyPreview(err.response.data, 2000)}`
    );
    return;
  }
  console.error(`[rapidapi] ${label} axios error (no response): ${err?.message || err}`);
}

/** Log HTTP failure body when validateStatus accepts 4xx/5xx without throwing. */
function logRapidApiHttpFailure(res, label, videoId = '') {
  if (!res || res.status < 400) return;
  console.error(
    `[rapidapi] ${label}${videoId ? ` video=${videoId}` : ''} ` +
      `response.status=${res.status} response.data=${rapidApiBodyPreview(res.data, 2000)}`
  );
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

  try {
    const res = await axios.get(url, {
      timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
      ...config,
      validateStatus: () => true,
    });

    assertQuotaAvailable(res, label);
    if (res.status >= 400) {
      logRapidApiHttpFailure(res, label);
    }
    return res;
  } catch (err) {
    logRapidApiAxiosError(err, label);
    throw err;
  }
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
  if (/file not ready|not ready|still processing|processing|preparing|try again/i.test(detail)) {
    return true;
  }
  if (res.status === 404 || res.status === 524) return true;
  return false;
}

/** JSON body indicates the CDN file is still being prepared. */
function isApiResponsePreparing(res) {
  if (!res || !res.data) return false;
  const detail = responseBodyText(res).toLowerCase();
  if (/prepar/i.test(detail)) return true;
  if (typeof res.data === 'object' && !Array.isArray(res.data)) {
    const status = String(
      res.data.status || res.data.fileStatus || res.data.state || res.data.file_state || ''
    ).toLowerCase();
    if (/prepar|processing|pending|not.?ready/i.test(status)) return true;
  }
  return false;
}

function isShortVideo({ durationSeconds = 0, isShortHint = false } = {}) {
  if (isShortHint) return true;
  return durationSeconds > 0 && durationSeconds <= SHORT_VIDEO_MAX_DURATION_SEC;
}

function getVideoPollingProfile({ durationSeconds = 0, isShortHint = false } = {}) {
  const short = isShortVideo({ durationSeconds, isShortHint });
  if (short) {
    return {
      short: true,
      downloadMaxAttempts: DOWNLOAD_POLL_MAX_ATTEMPTS,
      downloadWaitMs: DOWNLOAD_POLL_WAIT_MS,
      fileReadyMaxMs: FILE_READY_MAX_MS,
      fileReadyPollMs: FILE_READY_POLL_MS,
      stableSizeHits: 1,
    };
  }

  const longDuration = Math.max(durationSeconds, 120);
  const scale = longDuration > 600 ? 1.5 : 1;
  return {
    short: false,
    downloadMaxAttempts: DOWNLOAD_POLL_MAX_ATTEMPTS_LONG,
    downloadWaitMs: DOWNLOAD_POLL_WAIT_MS_LONG,
    fileReadyMaxMs: Math.round(FILE_READY_MAX_MS_LONG * scale),
    fileReadyPollMs: FILE_READY_POLL_MS_LONG,
    stableSizeHits: 2,
    durationSeconds: longDuration,
  };
}

function estimateMinFileBytes(durationSeconds, quality = '360p') {
  const height = parseHeight(quality) || 360;
  const bytesPerSec =
    height <= 360 ? MIN_BYTES_PER_SECOND_360P : MIN_BYTES_PER_SECOND_360P * (height / 360);
  const duration = Math.max(Number(durationSeconds) || 0, 45);
  return Math.min(Math.round(duration * bytesPerSec), 400 * 1024 * 1024);
}

function logDownloadFileNotReady(path, videoId, attempt, maxAttempts, waitMs, extra = '') {
  console.warn(
    `[rapidapi] ${path} file not ready video=${videoId} ` +
      `attempt=${attempt}/${maxAttempts}` +
      (extra ? ` ${extra}` : '') +
      ` ? retry in ${waitMs}ms`
  );
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
  try {
    const res = await axios.get(url, {
      timeout: RAPIDAPI_REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    assertQuotaAvailable(res, 'response_mode url');
    if (res.status >= 400) {
      logRapidApiHttpFailure(res, 'response_mode url');
    }
    console.log(
      `[rapidapi] response_mode url HTTP ${res.status} body=${rapidApiBodyPreview(res.data, 800)}`
    );
    return res.status < 400 ? res.data : data;
  } catch (err) {
    logRapidApiAxiosError(err, 'response_mode url');
    throw err;
  }
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
    logRapidApiHttpFailure(res, pathLabel, videoId);
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
    return { qualities: primary.qualities, source: 'get_available_quality', isShortHint: false, durationSeconds: 0 };
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
  let durationSeconds = 0;
  if (infoRes.status < 400 && infoRes.data && typeof infoRes.data === 'object') {
    const info = await unwrapResponseModeUrl(infoRes.data);
    const title = String(info.title || '').toLowerCase();
    durationSeconds = Number(info.lengthSeconds || info.duration || 0) || 0;
    isShortHint = durationSeconds > 0 && durationSeconds <= SHORT_VIDEO_MAX_DURATION_SEC;
    if (/short/i.test(title)) isShortHint = true;
    const fromInfo = parseQualitiesFromResponse(info);
    if (fromInfo.length > 0) {
      console.log(
        `[rapidapi] using ${fromInfo.length} qualities from get-video-info.availableQuality video=${videoId}`
      );
      return { qualities: fromInfo, source: 'get-video-info', isShortHint, durationSeconds };
    }
    console.warn(
      `[rapidapi] get-video-info had no availableQuality video=${videoId} ` +
        `title=${JSON.stringify(info.title || '').slice(0, 80)} duration=${info.lengthSeconds || '?'}`
    );
  } else if (infoRes.status >= 400) {
    logRapidApiHttpFailure(infoRes, 'get-video-info', videoId);
    console.warn(
      `[rapidapi] get-video-info failed video=${videoId} HTTP ${infoRes.status}: ${responseBodyText(infoRes).slice(0, 300)}`
    );
  }

  return { qualities: [], source: 'none', isShortHint, durationSeconds };
}

async function requestDownloadMeta(videoId, qualityId, downloadKind = 'video', pollingProfile = null) {
  const path = downloadKind === 'short' ? 'download_short' : 'download_video';
  const profile =
    pollingProfile ||
    getVideoPollingProfile({
      durationSeconds: 0,
      isShortHint: downloadKind === 'short',
    });
  const maxAttempts = profile.downloadMaxAttempts;
  const waitMs = profile.downloadWaitMs;
  let lastDetail = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

      if (isFileNotReadyHttpResponse(res) && attempt < maxAttempts) {
        logDownloadFileNotReady(path, videoId, attempt, maxAttempts, waitMs, `HTTP ${res.status}`);
        await sleep(waitMs);
        continue;
      }

      logRapidApiHttpFailure(res, path, videoId);
      const err = new Error(`RapidAPI ${path} HTTP ${res.status}: ${lastDetail}`);
      err.downloadKind = downloadKind;
      throw err;
    }

    logRapidApiResponse(path, res, videoId, { source: 'download-meta' });

    if (isApiResponsePreparing(res)) {
      lastDetail = 'API status preparing';
      if (attempt < maxAttempts) {
        logDownloadFileNotReady(path, videoId, attempt, maxAttempts, waitMs, lastDetail);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`RapidAPI ${path} file still preparing after ${maxAttempts} attempts`);
    }

    const file = res.data && res.data.file;
    if (!file || typeof file !== 'string') {
      lastDetail = 'response missing file URL';
      if (attempt < maxAttempts) {
        logDownloadFileNotReady(path, videoId, attempt, maxAttempts, waitMs, lastDetail);
        await sleep(waitMs);
        continue;
      }
      throw new Error(`RapidAPI ${path} response missing file URL after ${maxAttempts} attempts`);
    }

    try {
      await ensureCdnFileReady(file, {
        videoId,
        pollingProfile: profile,
        targetQuality: res.data.quality || null,
      });
      if (attempt > 1) {
        console.log(`[rapidapi] ${path} ready video=${videoId} after ${attempt} polling attempts`);
      }
      return {
        file,
        quality: res.data.quality || null,
        mime: res.data.mime || 'video/mp4',
        id: res.data.id,
      };
    } catch (readyErr) {
      lastDetail = readyErr?.message || 'CDN file not ready';
      if (attempt < maxAttempts) {
        logDownloadFileNotReady(path, videoId, attempt, maxAttempts, waitMs, lastDetail);
        await sleep(waitMs);
        continue;
      }
    }
  }

  throw new Error(`RapidAPI ${path} file not ready after ${maxAttempts} attempts: ${lastDetail}`);
}

async function requestDownloadMetaWithFallback(
  videoId,
  qualityId,
  { isShortHint = false, durationSeconds = 0, pollingProfile = null } = {}
) {
  const profile = pollingProfile || getVideoPollingProfile({ durationSeconds, isShortHint });
  const order = isShortHint ? ['short', 'video'] : ['video', 'short'];

  let lastErr = null;
  for (const kind of order) {
    try {
      return await requestDownloadMeta(videoId, qualityId, kind, profile);
    } catch (err) {
      lastErr = err;
      logRapidApiAxiosError(err, kind === 'short' ? 'download_short' : 'download_video');
      console.warn(
        `[rapidapi] ${kind === 'short' ? 'download_short' : 'download_video'} failed ` +
          `video=${videoId} qualityId=${qualityId}: ${err.message}`
      );
    }
  }
  throw lastErr || new Error('RapidAPI download failed');
}

async function probeCdnFile(fileUrl) {
  try {
    const head = await axios.head(fileUrl, {
      timeout: CDN_PROBE_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    assertQuotaAvailable(head, 'cdn HEAD probe');
    const rawLen = head.headers['content-length'];
    const contentLength = rawLen != null ? Number(rawLen) : -1;
    return {
      status: head.status || 0,
      contentLength: Number.isFinite(contentLength) ? contentLength : -1,
      acceptRanges: String(head.headers['accept-ranges'] || '').toLowerCase(),
    };
  } catch (err) {
    logRapidApiAxiosError(err, 'cdn HEAD probe');
    console.warn(`[rapidapi] file HEAD probe error: ${err.message}`);
    return { status: 0, contentLength: -1, acceptRanges: '' };
  }
}

async function probeFileUrl(fileUrl) {
  const probe = await probeCdnFile(fileUrl);
  return probe.status || 0;
}

/**
 * Wait until the CDN file looks complete ? not just HTTP 200.
 * Long videos: content-length must meet a minimum and stay stable across consecutive probes.
 */
async function ensureCdnFileReady(fileUrl, { videoId = '', pollingProfile, targetQuality = null } = {}) {
  const profile = pollingProfile || getVideoPollingProfile({});
  const startedAt = Date.now();
  const deadline = startedAt + profile.fileReadyMaxMs;
  const pollMs = profile.fileReadyPollMs;
  const requiredStableHits = profile.stableSizeHits || 1;
  const minBytes = profile.short
    ? 40_000
    : estimateMinFileBytes(profile.durationSeconds || 0, targetQuality || '360p');

  let lastLen = -1;
  let stableHits = 0;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    const probe = await probeCdnFile(fileUrl);

    if (probe.status !== 200) {
      stableHits = 0;
      lastLen = -1;
      console.warn(
        `[rapidapi] CDN not ready video=${videoId || '?'} attempt=${attempts} HTTP ${probe.status || 'error'} ` +
          `? retry in ${pollMs}ms`
      );
    } else {
      const len = probe.contentLength;
      if (len > 0) {
        if (len >= minBytes) {
          if (len === lastLen) {
            stableHits += 1;
          } else {
            stableHits = 1;
            lastLen = len;
          }
          if (stableHits >= requiredStableHits) {
            console.log(
              `[rapidapi] CDN ready video=${videoId || '?'} bytes=${len} stableHits=${stableHits} ` +
                `after ${Date.now() - startedAt}ms (${attempts} probes)`
            );
            return;
          }
          console.log(
            `[rapidapi] CDN growing video=${videoId || '?'} bytes=${len}/${minBytes} ` +
              `stable=${stableHits}/${requiredStableHits}`
          );
        } else if (profile.short && len >= 40_000) {
          console.log(
            `[rapidapi] CDN ready (short) video=${videoId || '?'} bytes=${len} after ${Date.now() - startedAt}ms`
          );
          return;
        } else {
          console.warn(
            `[rapidapi] CDN partial video=${videoId || '?'} bytes=${len}/${minBytes} ` +
              `attempt=${attempts} ? retry in ${pollMs}ms`
          );
          lastLen = len;
          stableHits = 0;
        }
      } else {
        // No content-length ? some CDNs omit it until the file is complete.
        if (profile.short) {
          console.log(
            `[rapidapi] CDN ready (short, no length) video=${videoId || '?'} after ${Date.now() - startedAt}ms`
          );
          return;
        }
        if (attempts >= 4) {
          console.log(
            `[rapidapi] CDN ready (long, no length after ${attempts} OK probes) video=${videoId || '?'} ` +
              `after ${Date.now() - startedAt}ms`
          );
          return;
        }
        console.warn(
          `[rapidapi] CDN missing content-length video=${videoId || '?'} attempt=${attempts} ? retry in ${pollMs}ms`
        );
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollMs, remaining));
  }

  const waitedMs = Date.now() - startedAt;
  const msg =
    `RapidAPI CDN file not ready after ${waitedMs}ms (limit ${profile.fileReadyMaxMs}ms, ` +
    `${attempts} probes, minBytes=${minBytes}, lastLen=${lastLen}). ` +
    'The CDN file may still be processing ? retry in 15?30 seconds.';
  console.error(`[rapidapi] ${msg} video=${videoId || '?'} url=${String(fileUrl).slice(0, 96)}?`);
  throw new Error(msg);
}

async function waitForFileReady(fileUrl, { videoId = '', pollingProfile = null } = {}) {
  await ensureCdnFileReady(fileUrl, { videoId, pollingProfile });
}

/**
 * Resolve a direct playable URL for a YouTube videoId via RapidAPI.
 * @returns {Promise<{ url: string, quality: string|null, mime: string }>}
 */
async function resolveVideoDownloadUrl(videoId, requestedQuality = '360p') {
  const targetQuality = normalizeStreamQuality(requestedQuality);
  const { qualities, source, isShortHint, durationSeconds } = await getAvailableQualities(videoId);
  const pollingProfile = getVideoPollingProfile({ durationSeconds, isShortHint });

  console.log(
    `[rapidapi] resolve video=${videoId} target=${targetQuality} qualitySource=${source} ` +
      `count=${qualities.length} shortHint=${isShortHint} duration=${durationSeconds || '?'}s ` +
      `pollMax=${pollingProfile.downloadMaxAttempts} fileReadyMax=${pollingProfile.fileReadyMaxMs}ms`
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

  const meta = await requestDownloadMetaWithFallback(videoId, qualityId, {
    isShortHint,
    durationSeconds,
    pollingProfile,
  });

  console.log(
    `[rapidapi] CDN ready video=${videoId} quality=${targetQuality} url=${meta.file.slice(0, 96)}...`
  );

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
    logRapidApiHttpFailure(res, 'get-video-info', videoId);
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
  probeCdnFile,
  ensureCdnFileReady,
  getVideoPollingProfile,
};
