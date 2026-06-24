'use strict';

const os = require('os');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv optional */
}

const { ensureYtDlpBinary } = require('./ensure-ytdlp.cjs');
const streamStatusStore = require('./stream-status-store.cjs');
const { runIngestPipeline } = require('./run-ingest-pipeline.cjs');

const WORKER_ID =
  String(process.env.INGEST_WORKER_ID || '').trim() ||
  `ingest-${os.hostname()}-${process.pid}`;
const POLL_MS = Math.max(500, Number(process.env.INGEST_WORKER_POLL_MS || 2000));
const MAX_CONCURRENT = Math.max(1, Number(process.env.INGEST_WORKER_CONCURRENCY || 1));

let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob(job) {
  const videoId = job.youtube_video_id;
  const quality = job.quality;
  const progress = {
    phase: 'starting',
    activeSource: 'bunny',
    detail: 'Worker started ingest pipeline',
    retryAfterMs: 3000,
  };

  console.log(`[ingest-worker] processing video=${videoId} quality=${quality} worker=${WORKER_ID}`);

  try {
    const resolved = await runIngestPipeline(videoId, quality, { progress });
    await streamStatusStore.markReady(videoId, quality, {
      playbackUrl: resolved.url,
      bunnyGuid: resolved.bunnyGuid,
    });
    console.log(
      `[ingest-worker] ready video=${videoId} guid=${resolved.bunnyGuid || '?'} url=${resolved.url.slice(0, 96)}…`
    );
  } catch (err) {
    console.error(`[ingest-worker] failed video=${videoId}: ${err?.message || err}`);
    await streamStatusStore.markFailed(videoId, quality, err);
  }
}

async function workerLoop(slot) {
  while (!shuttingDown) {
    const job = await streamStatusStore.claimNextJob(`${WORKER_ID}:${slot}`);
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }
    await processJob(job);
  }
}

async function main() {
  if (!streamStatusStore.isConfigured()) {
    console.error('[ingest-worker] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    process.exit(1);
  }

  try {
    ensureYtDlpBinary({ strict: true });
  } catch (err) {
    console.error(`[ingest-worker] yt-dlp not available: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `[ingest-worker] started id=${WORKER_ID} concurrency=${MAX_CONCURRENT} pollMs=${POLL_MS}`
  );

  const loops = [];
  for (let slot = 0; slot < MAX_CONCURRENT; slot++) {
    loops.push(workerLoop(slot));
  }
  await Promise.all(loops);
}

process.on('SIGTERM', () => {
  console.log('[ingest-worker] SIGTERM — draining');
  shuttingDown = true;
});
process.on('SIGINT', () => {
  console.log('[ingest-worker] SIGINT — draining');
  shuttingDown = true;
});

main().catch((err) => {
  console.error('[ingest-worker] fatal:', err);
  process.exit(1);
});
