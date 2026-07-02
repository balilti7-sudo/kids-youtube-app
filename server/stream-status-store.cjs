'use strict';

const { createClient } = require('@supabase/supabase-js');

let client = null;

const ACTIVE_STATUSES = new Set(['queued', 'processing']);
const TERMINAL_FAILED_CODES = new Set([
  'VIDEO_UNAVAILABLE_152',
  'YT_DLP_152',
  'INVALID_MEDIA_URL',
  'INGEST_FAILED',
]);

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
  if (err?.ytDlpErrorCode152Unavailable || /error code:\s*152/i.test(msg)) {
    return { errorCode: 'VIDEO_UNAVAILABLE_152', errorDetail: msg };
  }
  if (err?.exitCode === 152 || err?.youtubeBotBlock) {
    return { errorCode: 'YT_DLP_152', errorDetail: msg };
  }
  if (err?.exitCode === 111 || err?.proxyConnectionRefused) {
    return { errorCode: 'PROXY_CONNECTION_REFUSED', errorDetail: msg };
  }
  if (/no direct media url|no fetchable media url|invalid media url/i.test(msg)) {
    return { errorCode: 'INVALID_MEDIA_URL', errorDetail: msg };
  }
  // Bunny still encoding when the per-attempt wait expired — retryable, not a real failure.
  if (
    err?.fileNotReady ||
    /transcoding not finished|file not ready|not ready after|still processing|not visible in library yet/i.test(msg)
  ) {
    return { errorCode: 'FILE_NOT_READY', errorDetail: msg };
  }
  return { errorCode: 'INGEST_FAILED', errorDetail: msg };
}

function isRetryableErrorCode(errorCode) {
  if (!errorCode) return false;
  if (TERMINAL_FAILED_CODES.has(errorCode)) return false;
  if (errorCode === 'VIDEO_UNAVAILABLE_152') return false;
  return /PROXY|TIMEOUT|QUEUE|TRANSCOD|FILE_NOT_READY/i.test(String(errorCode));
}

async function upsertRow(youtubeVideoId, quality, fields) {
  const sb = getClient();
  if (!sb) return null;

  const row = {
    youtube_video_id: String(youtubeVideoId || '').trim(),
    quality: normalizeQuality(quality),
    updated_at: new Date().toISOString(),
    ...fields,
  };

  if (!row.youtube_video_id || !row.status) return null;

  const { data, error } = await sb
    .from('video_stream_prepare')
    .upsert(row, { onConflict: 'youtube_video_id,quality' })
    .select()
    .maybeSingle();

  if (error) {
    console.error(
      `[stream-status] upsert failed video=${row.youtube_video_id} status=${row.status}: ${error.message}`
    );
    return null;
  }

  console.log(
    `[stream-status] video=${row.youtube_video_id} quality=${row.quality} status=${row.status}` +
      (row.error_code ? ` error=${row.error_code}` : '')
  );
  return data;
}

async function getJob(youtubeVideoId, quality) {
  const sb = getClient();
  if (!sb) return null;

  const { data, error } = await sb
    .from('video_stream_prepare')
    .select('*')
    .eq('youtube_video_id', String(youtubeVideoId || '').trim())
    .eq('quality', normalizeQuality(quality))
    .maybeSingle();

  if (error) {
    console.error(`[stream-status] getJob failed video=${youtubeVideoId}: ${error.message}`);
    return null;
  }
  return data;
}

function markQueued(youtubeVideoId, quality) {
  return upsertRow(youtubeVideoId, quality, {
    status: 'queued',
    error_code: null,
    error_detail: null,
    playback_url: null,
    bunny_guid: null,
    locked_by: null,
    locked_at: null,
    attempt_count: 0,
  });
}

/**
 * Put a job back in the queue after a retryable failure (e.g. suspected
 * session-block 152), preserving the attempt counter so the worker can cap retries.
 */
function requeueForRetry(youtubeVideoId, quality, { attemptCount = 1, err = null } = {}) {
  const meta = err ? ingestErrorMeta(err) : { errorCode: null, errorDetail: null };
  return upsertRow(youtubeVideoId, quality, {
    status: 'queued',
    // Keep last error visible for debugging while the job waits in queue.
    error_code: meta.errorCode,
    error_detail: meta.errorDetail,
    locked_by: null,
    locked_at: null,
    attempt_count: Math.max(1, Number(attemptCount) || 1),
  });
}

function markProcessing(youtubeVideoId, quality, { lockedBy = null } = {}) {
  return upsertRow(youtubeVideoId, quality, {
    status: 'processing',
    error_code: null,
    error_detail: null,
    locked_by: lockedBy,
    locked_at: lockedBy ? new Date().toISOString() : null,
  });
}

function markReady(youtubeVideoId, quality, { playbackUrl = null, bunnyGuid = null } = {}) {
  return upsertRow(youtubeVideoId, quality, {
    status: 'ready',
    error_code: null,
    error_detail: null,
    playback_url: playbackUrl || null,
    bunny_guid: bunnyGuid || null,
    locked_by: null,
    locked_at: null,
    attempt_count: 0,
  });
}

function markFailed(youtubeVideoId, quality, err) {
  const meta = ingestErrorMeta(err);
  return upsertRow(youtubeVideoId, quality, {
    status: 'failed',
    error_code: meta.errorCode,
    error_detail: meta.errorDetail,
    locked_by: null,
    locked_at: null,
  });
}

/**
 * Idempotent enqueue for the API — never runs yt-dlp.
 */
async function enqueue(youtubeVideoId, quality, { forceRestart = false } = {}) {
  const existing = await getJob(youtubeVideoId, quality);
  if (existing) {
    if (existing.status === 'ready') return existing;
    if (ACTIVE_STATUSES.has(existing.status)) return existing;
    if (existing.status === 'failed') {
      if (forceRestart && isRetryableErrorCode(existing.error_code)) {
        return markQueued(youtubeVideoId, quality);
      }
      return existing;
    }
  }
  return markQueued(youtubeVideoId, quality);
}

/**
 * Claim the oldest queued job for a worker (optimistic status guard).
 */
async function claimNextJob(workerId) {
  const sb = getClient();
  if (!sb) return null;

  const { data: candidates, error: listErr } = await sb
    .from('video_stream_prepare')
    .select('*')
    .eq('status', 'queued')
    .order('updated_at', { ascending: true })
    .limit(1);

  if (listErr) {
    console.error(`[stream-status] claim list failed: ${listErr.message}`);
    return null;
  }

  const candidate = candidates?.[0];
  if (!candidate) return null;

  const { data: claimed, error: claimErr } = await sb
    .from('video_stream_prepare')
    .update({
      status: 'processing',
      locked_by: String(workerId || 'worker'),
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('youtube_video_id', candidate.youtube_video_id)
    .eq('quality', candidate.quality)
    .eq('status', 'queued')
    .select()
    .maybeSingle();

  if (claimErr) {
    console.error(`[stream-status] claim update failed: ${claimErr.message}`);
    return null;
  }

  return claimed;
}

/** Worker publishes its egress diagnostics here (read back by the bridge /api/diagnostics). */
async function saveWorkerDiagnostics(workerId, data) {
  const sb = getClient();
  if (!sb) return null;
  const { error } = await sb.from('worker_diagnostics').upsert(
    {
      id: String(workerId || 'ingest-worker'),
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) {
    console.warn(`[stream-status] saveWorkerDiagnostics failed: ${error.message}`);
    return null;
  }
  return true;
}

async function getWorkerDiagnostics() {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('worker_diagnostics')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) {
    console.warn(`[stream-status] getWorkerDiagnostics failed: ${error.message}`);
    return [];
  }
  return data || [];
}

module.exports = {
  markQueued,
  markProcessing,
  saveWorkerDiagnostics,
  getWorkerDiagnostics,
  markReady,
  markFailed,
  requeueForRetry,
  enqueue,
  getJob,
  claimNextJob,
  ingestErrorMeta,
  isRetryableErrorCode,
  isConfigured: () => Boolean(getClient()),
  ACTIVE_STATUSES,
};
