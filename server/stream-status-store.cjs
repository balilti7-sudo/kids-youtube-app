'use strict';

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getClient() {
  if (client) return client;
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE ||
      ''
  ).trim();
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function normalizeQuality(raw, fallback = '360p') {
  const q = String(raw || fallback).trim().toLowerCase();
  return ['240p', '360p', '480p', '720p', '1080p'].includes(q) ? q : fallback;
}

function ingestErrorMeta(err) {
  const msg = String(err?.message || err || '').slice(0, 500);
  if (err?.exitCode === 152 || err?.youtubeBotBlock) {
    return { errorCode: 'YT_DLP_152', errorDetail: msg };
  }
  if (err?.exitCode === 111 || err?.proxyConnectionRefused) {
    return { errorCode: 'PROXY_CONNECTION_REFUSED', errorDetail: msg };
  }
  if (/no direct media url|no fetchable media url|invalid media url/i.test(msg)) {
    return { errorCode: 'INVALID_MEDIA_URL', errorDetail: msg };
  }
  return { errorCode: 'INGEST_FAILED', errorDetail: msg };
}

async function upsertStatus(youtubeVideoId, quality, payload) {
  const sb = getClient();
  if (!sb) return false;

  const row = {
    youtube_video_id: String(youtubeVideoId || '').trim(),
    quality: normalizeQuality(quality),
    status: payload.status,
    error_code: payload.errorCode || null,
    error_detail: payload.errorDetail ? String(payload.errorDetail).slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  };

  if (!row.youtube_video_id) return false;

  const { error } = await sb.from('video_stream_prepare').upsert(row, {
    onConflict: 'youtube_video_id,quality',
  });

  if (error) {
    console.error(
      `[stream-status] upsert failed video=${row.youtube_video_id} status=${row.status}: ${error.message}`
    );
    return false;
  }

  console.log(
    `[stream-status] video=${row.youtube_video_id} quality=${row.quality} status=${row.status}` +
      (row.error_code ? ` error=${row.error_code}` : '')
  );
  return true;
}

function markProcessing(youtubeVideoId, quality) {
  return upsertStatus(youtubeVideoId, quality, {
    status: 'processing',
    errorCode: null,
    errorDetail: null,
  });
}

function markReady(youtubeVideoId, quality) {
  return upsertStatus(youtubeVideoId, quality, {
    status: 'ready',
    errorCode: null,
    errorDetail: null,
  });
}

function markFailed(youtubeVideoId, quality, err) {
  const meta = ingestErrorMeta(err);
  return upsertStatus(youtubeVideoId, quality, {
    status: 'failed',
    errorCode: meta.errorCode,
    errorDetail: meta.errorDetail,
  });
}

module.exports = {
  markProcessing,
  markReady,
  markFailed,
  ingestErrorMeta,
  isConfigured: () => Boolean(getClient()),
};
