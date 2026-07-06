'use strict';

/**
 * YouTube stream URL resolution via InnerTube (youtubei.js) on the bridge.
 * Avoids browser CORS blocks — the frontend calls GET /api/youtube/resolve/:videoId
 * instead of contacting youtube.com directly.
 */

const HEIGHT_BY_QUALITY = {
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
};

let innertubePromise = null;

async function loadYoutubei() {
  return import('youtubei.js');
}

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = loadYoutubei().then(({ Innertube, ClientType }) =>
      Innertube.create({
        client_type: ClientType.ANDROID,
        generate_session_locally: true,
      })
    );
  }
  return innertubePromise;
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

  const yt = await getInnertube();
  const { ClientType } = await loadYoutubei();
  const info = await yt.getBasicInfo(id, { client: ClientType.ANDROID });

  const status = info.playability_status?.status;
  if (status && status !== 'OK') {
    throw new Error(info.playability_status?.reason || status || 'Video unplayable');
  }

  const formats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ];

  if (!formats.length) {
    throw new Error('No stream formats returned by YouTube');
  }

  const format = pickProgressiveFormat(formats, minHeight) || pickAdaptiveVideoFormat(formats, minHeight);
  if (!format) {
    throw new Error(`No ${q} stream format available`);
  }

  const playbackUrl = await formatPlaybackUrl(format, yt.session.player);
  const mime = format.mime_type || 'video/mp4';
  const isHls = /\.m3u8(\?|$)/i.test(playbackUrl) || /mpegurl/i.test(mime);

  return {
    playbackUrl,
    mime,
    format: isHls ? 'hls' : 'direct',
    quality: format.quality_label || q,
  };
}

module.exports = {
  resolveYoutubeStream,
};
