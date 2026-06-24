'use strict';

/**
 * Full yt-dlp → Bunny ingest pipeline (worker only — not for the HTTP API).
 */
const bunnyStream = require('./bunny-stream.cjs');

const ALLOWED_QUALITIES = new Set(['240p', '360p', '480p', '720p', '1080p']);

function normalizeQuality(raw, fallback = '360p') {
  const q = String(raw || fallback).trim().toLowerCase();
  return ALLOWED_QUALITIES.has(q) ? q : fallback;
}

/**
 * @param {string} videoId
 * @param {string} [rawQuality]
 * @param {object} [options]
 * @param {object} [options.progress] — mutable status object for logging
 */
async function runIngestPipeline(videoId, rawQuality = '360p', { progress = null } = {}) {
  if (!bunnyStream.isConfigured()) {
    throw new Error(
      'Bunny Stream is not configured (set BUNNY_STREAM_API_KEY and BUNNY_LIBRARY_ID)'
    );
  }

  const quality = normalizeQuality(rawQuality);

  if (progress) {
    progress.activeSource = 'bunny';
    progress.phase = progress.phase || 'resolve';
    progress.detail = progress.detail || 'Resolving via Bunny Stream';
    progress.retryAfterMs = progress.retryAfterMs || 3000;
  }

  const resolved = await bunnyStream.resolveVideoDownloadUrl(videoId, quality, progress);
  if (!resolved?.url) {
    throw new Error(`Bunny Stream returned no playable URL for ${videoId}`);
  }

  return {
    url: resolved.url,
    upstreamUrl: resolved.url,
    quality: resolved.quality || quality,
    mime: resolved.mime || 'application/vnd.apple.mpegurl',
    format: resolved.format || 'hls',
    proxied: false,
    source: 'bunny',
    bunnyGuid: resolved.bunnyGuid || null,
    requestedQuality: quality,
  };
}

module.exports = {
  runIngestPipeline,
  normalizeQuality,
};
