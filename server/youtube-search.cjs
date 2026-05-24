'use strict';

const ytsr = require('ytsr');
const yts = require('yt-search');

const SEARCH_LOCALE = {
  hl: 'he',
  gl: 'IL',
};

function encodeContinuation(continuation) {
  if (!continuation) return null;
  try {
    return Buffer.from(JSON.stringify(continuation), 'utf8').toString('base64url');
  } catch {
    return null;
  }
}

function decodeContinuation(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapVideoItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && item.type === 'video' && typeof item.id === 'string' && item.id.length === 11)
    .map((item) => ({
      videoId: item.id,
      title: item.title || 'ללא כותרת',
      thumbnail:
        item.bestThumbnail?.url ||
        (Array.isArray(item.thumbnails) && item.thumbnails[0]?.url) ||
        `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      channelTitle: item.author?.name || '',
    }));
}

async function resolveVideoSearchUrl(query) {
  const filters = await ytsr.getFilters(query, { hl: 'en', gl: 'US' });
  const typeFilters = filters.get('Type');
  const videoFilter =
    typeFilters?.get('Videos') ||
    typeFilters?.get('Video') ||
    [...(typeFilters?.values() ?? [])].find((entry) => /video/i.test(entry?.name || ''));
  if (videoFilter?.url) {
    return videoFilter.url;
  }
  throw new Error('video_filter_unavailable');
}

async function searchVideosByQuery(query, continuationToken) {
  const decoded = decodeContinuation(continuationToken);
  let batch;

  if (decoded) {
    batch = await ytsr.continueReq(decoded);
  } else {
    let searchTarget = query;
    try {
      searchTarget = await resolveVideoSearchUrl(query);
    } catch (err) {
      console.warn('[youtube-search] video filter unavailable, searching all results:', err?.message || err);
    }
    batch = await ytsr(searchTarget, {
      ...SEARCH_LOCALE,
      safeSearch: true,
      pages: 1,
    });
  }

  const items = batch.items ?? batch;
  const videos = mapVideoItems(Array.isArray(items) ? items : []);
  const nextContinuation = encodeContinuation(batch.continuation || null);

  return {
    videos,
    continuation: nextContinuation,
    hasMore: Boolean(batch.continuation),
  };
}

async function lookupVideoById(videoId) {
  const video = await yts({ videoId });
  if (!video?.videoId) {
    return [];
  }
  return [
    {
      videoId: video.videoId,
      title: video.title || 'ללא כותרת',
      thumbnail:
        video.thumbnail ||
        (video.image && typeof video.image === 'string' ? video.image : '') ||
        `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      channelTitle: video.author?.name || '',
    },
  ];
}

async function searchYouTube(query, continuationToken) {
  const q = String(query || '').trim();
  if (!q) {
    return { videos: [], continuation: null, hasMore: false };
  }

  if (/^[\w-]{11}$/.test(q) && !continuationToken) {
    const videos = await lookupVideoById(q);
    return { videos, continuation: null, hasMore: false };
  }

  return searchVideosByQuery(q, continuationToken);
}

module.exports = {
  searchYouTube,
};
