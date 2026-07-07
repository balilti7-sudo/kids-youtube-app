'use strict';

/**
 * YouTube metadata + stream resolution via InnerTube (youtubei.js) on the bridge.
 * Replaces oEmbed (often 404 from datacenter IPs) and avoids browser CORS blocks.
 * Authenticates via Netscape cookies.txt when configured (bypasses bot checks).
 */

const youtubeCookies = require('./youtube-cookies.cjs');

const DEFAULT_DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEIGHT_BY_QUALITY = {
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};

/** Anonymous: ANDROID first for direct googlevideo URLs. */
const STREAM_CLIENT_ORDER_ANON = ['ANDROID', 'IOS', 'WEB'];
/** Logged-in cookies: WEB only — keeps MEDIA_USER_AGENT + SAPISID auth aligned with desktop cookies. */
const STREAM_CLIENT_ORDER_AUTH = ['WEB'];
const METADATA_CLIENT_ORDER_ANON = ['ANDROID', 'WEB', 'IOS'];
const METADATA_CLIENT_ORDER_AUTH = ['WEB'];

const innertubeByClient = new Map();
let cookiesRevision = -1;
let mediaUserAgentRevision = '';

function getMediaUserAgent() {
  return String(process.env.MEDIA_USER_AGENT || '').trim() || DEFAULT_DESKTOP_CHROME_UA;
}

/**
 * youtubei.js overwrites User-Agent for ANDROID/IOS InnerTube calls.
 * Wrap fetch so MEDIA_USER_AGENT is forced on every outbound request.
 */
function createMediaUserAgentFetch() {
  const underlying = globalThis.fetch.bind(globalThis);
  return async function mediaUserAgentFetch(input, init = {}) {
    const ua = getMediaUserAgent();
    const headers = new Headers(
      init?.headers ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    headers.set('User-Agent', ua);
    return underlying(input, { ...init, headers });
  };
}

function applyMediaUserAgentToSession(yt, clientName) {
  const ua = getMediaUserAgent();
  if (yt?.session) {
    yt.session.user_agent = ua;
    if (yt.session.context?.client) {
      yt.session.context.client.userAgent = ua;
    }
  }
  const fromEnv = Boolean(String(process.env.MEDIA_USER_AGENT || '').trim());
  console.log(
    `[innertube] session ready client=${clientName} ua=${ua.slice(0, 96)}${ua.length > 96 ? '…' : ''}` +
      (fromEnv ? ' (MEDIA_USER_AGENT)' : ' (default desktop Chrome)')
  );
  return yt;
}

function syncInnertubeSessions() {
  const rev = youtubeCookies.getCookiesRevision();
  const uaRev = getMediaUserAgent();
  if (rev !== cookiesRevision || uaRev !== mediaUserAgentRevision) {
    if (innertubeByClient.size > 0) {
      console.log('[innertube] cookie or MEDIA_USER_AGENT changed — clearing InnerTube session cache');
    }
    innertubeByClient.clear();
    cookiesRevision = rev;
    mediaUserAgentRevision = uaRev;
  }
}

function streamClientOrder() {
  return youtubeCookies.isLoggedIn() ? STREAM_CLIENT_ORDER_AUTH : STREAM_CLIENT_ORDER_ANON;
}

function metadataClientOrder() {
  return youtubeCookies.isLoggedIn() ? METADATA_CLIENT_ORDER_AUTH : METADATA_CLIENT_ORDER_ANON;
}

function isBotCheckMessage(text) {
  return /sign in to confirm|not a bot|confirm you.?re not a bot|bot check|captcha/i.test(
    String(text || '')
  );
}

async function loadYoutubei() {
  return import('youtubei.js');
}

async function getInnertube(clientName) {
  syncInnertubeSessions();
  const name = String(clientName || 'ANDROID').toUpperCase();
  const cookieHeader = youtubeCookies.getCookieHeader();
  const ua = getMediaUserAgent();
  const cacheKey = `${name}:${cookieHeader ? 'auth' : 'anon'}:${ua}`;

  if (!innertubeByClient.has(cacheKey)) {
    innertubeByClient.set(
      cacheKey,
      loadYoutubei().then(({ Innertube, ClientType }) => {
        const client_type = ClientType[name] ?? ClientType.ANDROID;
        const options = {
          client_type,
          generate_session_locally: true,
          retrieve_player: true,
          user_agent: ua,
          fetch: createMediaUserAgentFetch(),
        };
        if (cookieHeader) {
          options.cookie = cookieHeader;
        }
        if (name === 'WEB' || name === 'MWEB') {
          options.device_category = 'desktop';
        }
        return Innertube.create(options).then((yt) => applyMediaUserAgentToSession(yt, name));
      })
    );
  }

  const yt = await innertubeByClient.get(cacheKey);
  const { ClientType } = await loadYoutubei();
  return { yt, client: ClientType[name] ?? ClientType.ANDROID, clientName: name };
}

function pickProgressiveFormat(formats, minHeight) {
  const progressive = formats
    .filter((f) => f.has_video && f.has_audio)
    .sort((a, b) => (a.height || 0) - (b.height || 0));
  return (
    progressive.find((f) => (f.height || 0) >= minHeight) ||
    progressive[progressive.length - 1] ||
    null
  );
}

function pickAdaptiveVideoFormat(formats, minHeight) {
  const videoOnly = formats
    .filter((f) => f.has_video && !f.has_audio)
    .sort((a, b) => (a.height || 0) - (b.height || 0));
  return (
    videoOnly.find((f) => (f.height || 0) >= minHeight) ||
    videoOnly[videoOnly.length - 1] ||
    null
  );
}

async function formatPlaybackUrl(format, player) {
  if (format.url) return format.url;
  if (player && typeof format.decipher === 'function') {
    const url = await format.decipher(player);
    if (url) return url;
  }
  throw new Error('Stream format has no playable URL');
}

function mapThumbnails(thumbnail) {
  if (!Array.isArray(thumbnail)) return [];
  return thumbnail
    .map((t) => (t && typeof t.url === 'string' ? { url: t.url } : null))
    .filter(Boolean);
}

function mapBasicInfoToVideoInfo(info) {
  const basic = info?.basic_info || {};
  const thumbs = mapThumbnails(basic.thumbnail);
  return {
    title: basic.title || null,
    lengthSeconds: basic.duration != null ? Number(basic.duration) : null,
    author: basic.author || null,
    ownerChannelName: basic.author || null,
    externalChannelId: basic.channel_id || null,
    thumbnail: thumbs,
    isLiveContent: Boolean(basic.is_live || basic.is_live_content),
    liveBroadcastDetails: { isLiveNow: Boolean(basic.is_live) },
    isUpcoming: Boolean(basic.is_upcoming),
  };
}

async function getBasicInfoWithFallback(videoId, clientOrder) {
  let lastErr = null;

  for (const clientName of clientOrder) {
    try {
      const { yt, client } = await getInnertube(clientName);
      const info = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      const reason = info.playability_status?.reason || status;

      if (isBotCheckMessage(reason)) {
        lastErr = new Error(
          reason ||
            'YouTube bot check — ensure MEDIA_USER_AGENT matches the browser that exported cookies, then refresh COOKIES_CONTENT'
        );
        console.warn(
          `[innertube] ${clientName} bot check video=${videoId} ua=${getMediaUserAgent().slice(0, 72)}…`
        );
        continue;
      }

      if (status === 'LOGIN_REQUIRED' || status === 'CONTENT_CHECK_REQUIRED') {
        lastErr = new Error(reason || status);
        console.warn(`[innertube] ${clientName} playability=${status} video=${videoId}`);
        continue;
      }

      if (status && status !== 'OK' && status !== 'UNPLAYABLE') {
        if (info.basic_info?.title) {
          console.warn(
            `[innertube] ${clientName} playability=${status} video=${videoId} — using partial metadata`
          );
          return { info, clientName, yt };
        }
        lastErr = new Error(reason || status);
        continue;
      }

      return { info, clientName, yt };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[innertube] getBasicInfo ${clientName} failed video=${videoId}: ${err?.message || err}`
      );
    }
  }

  throw lastErr || new Error('InnerTube metadata unavailable');
}

/**
 * Video metadata for /api/info and live-status checks (no oEmbed).
 * @param {string} videoId
 */
async function fetchYoutubeVideoInfo(videoId) {
  const id = String(videoId || '').trim();
  if (!/^[\w-]{11}$/.test(id)) {
    throw new Error('Invalid YouTube video id');
  }

  const { info } = await getBasicInfoWithFallback(id, metadataClientOrder());
  return mapBasicInfoToVideoInfo(info);
}

/**
 * Lightweight metadata payload for GET /api/youtube/metadata/:videoId
 * @param {string} videoId
 */
async function fetchYoutubeMetadata(videoId) {
  const id = String(videoId || '').trim();
  if (!/^[\w-]{11}$/.test(id)) {
    throw new Error('Invalid YouTube video id');
  }

  const { info } = await getBasicInfoWithFallback(id, metadataClientOrder());
  const basic = info.basic_info || {};
  const thumbs = mapThumbnails(basic.thumbnail);
  const thumb =
    thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

  return {
    videoId: id,
    title: basic.title || null,
    author: basic.author || null,
    thumbnail: thumb,
    duration: basic.duration != null ? Number(basic.duration) : null,
    channelId: basic.channel_id || null,
    isLive: Boolean(basic.is_live),
    isUpcoming: Boolean(basic.is_upcoming),
  };
}

/**
 * @param {string} videoId
 * @param {string} [quality]
 * @returns {Promise<{ playbackUrl: string, mime: string, format: 'direct'|'hls', quality: string }>}
 */
async function resolveYoutubeStream(videoId, quality = '360p') {
  const id = String(videoId || '').trim();
  if (!/^[\w-]{11}$/.test(id)) {
    throw new Error('Invalid YouTube video id');
  }

  const q = String(quality || '360p').trim().toLowerCase();
  const minHeight = HEIGHT_BY_QUALITY[q] || 360;
  let lastErr = null;

  for (const clientName of streamClientOrder()) {
    try {
      const { info, yt } = await getBasicInfoWithFallback(id, [clientName]);
      const status = info.playability_status?.status;
      const reason = info.playability_status?.reason || status;
      if (status && status !== 'OK') {
        throw new Error(reason || status || 'Video unplayable');
      }

      const formats = [
        ...(info.streaming_data?.formats || []),
        ...(info.streaming_data?.adaptive_formats || []),
      ];

      if (!formats.length) {
        throw new Error('No stream formats returned by YouTube');
      }

      const format =
        pickProgressiveFormat(formats, minHeight) || pickAdaptiveVideoFormat(formats, minHeight);
      if (!format) {
        throw new Error(`No ${q} stream format available`);
      }

      const playbackUrl = await formatPlaybackUrl(format, yt.session.player);
      const mime = format.mime_type || 'video/mp4';
      const isHls = /\.m3u8(\?|$)/i.test(playbackUrl) || /mpegurl/i.test(mime);

      console.log(
        `[innertube] resolved stream video=${id} client=${clientName} quality=${q}` +
          (youtubeCookies.isLoggedIn() ? ' auth=cookies' : '') +
          ` ua=${getMediaUserAgent().slice(0, 48)}…`
      );

      return {
        playbackUrl,
        mime,
        format: isHls ? 'hls' : 'direct',
        quality: format.quality_label || q,
      };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[innertube] resolve ${clientName} failed video=${id}: ${err?.message || err}`
      );
    }
  }

  throw lastErr || new Error('InnerTube stream resolve failed');
}

function getCookiesStatus() {
  return youtubeCookies.getStatus();
}

module.exports = {
  DEFAULT_DESKTOP_CHROME_UA,
  getMediaUserAgent,
  getCookiesStatus,
  fetchYoutubeVideoInfo,
  fetchYoutubeMetadata,
  resolveYoutubeStream,
};
