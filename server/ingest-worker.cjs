'use strict';

const os = require('os');
const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv optional */
}

// The worker decides retry vs. permanent failure — ingest-ytdlp must not mark
// Supabase failed on the first "Error code: 152" (may be an IP/session block).
process.env.YT_DLP_DEFER_FAILURE_MARKING = '1';

const { ensureYtDlpBinary } = require('./ensure-ytdlp.cjs');
const streamStatusStore = require('./stream-status-store.cjs');
const { runIngestPipeline } = require('./run-ingest-pipeline.cjs');
const ingestYtdlp = require('./ingest-ytdlp.cjs');

const WORKER_ID =
  String(process.env.INGEST_WORKER_ID || '').trim() ||
  `ingest-${os.hostname()}-${process.pid}`;
const POLL_MS = Math.max(500, Number(process.env.INGEST_WORKER_POLL_MS || 2000));
const MAX_CONCURRENT = Math.max(1, Number(process.env.INGEST_WORKER_CONCURRENCY || 1));
/** Random pause between jobs so YouTube sees human-ish pacing per proxy session. */
const JOB_DELAY_MIN_MS = Math.max(0, Number(process.env.INGEST_WORKER_JOB_DELAY_MIN_MS || 15_000));
const JOB_DELAY_MAX_MS = Math.max(
  JOB_DELAY_MIN_MS,
  Number(process.env.INGEST_WORKER_JOB_DELAY_MAX_MS || 45_000)
);
/** "Error code: 152" is requeued up to N attempts before it is marked failed. */
const MAX_152_ATTEMPTS = Math.max(1, Number(process.env.INGEST_MAX_152_ATTEMPTS || 3));

let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJobDelayMs() {
  if (JOB_DELAY_MAX_MS <= 0) return 0;
  return JOB_DELAY_MIN_MS + Math.floor(Math.random() * (JOB_DELAY_MAX_MS - JOB_DELAY_MIN_MS + 1));
}

/**
 * "Error code: 152" on one fresh attempt may be a session-level soft block
 * disguised as "video unavailable" — requeue with a new proxy session before
 * declaring the video permanently unavailable.
 */
async function handleIngestFailure(job, err) {
  const videoId = job.youtube_video_id;
  const quality = job.quality;
  const attempt = (Number(job.attempt_count) || 0) + 1;

  if (ingestYtdlp.isYtDlpErrorCode152Unavailable(err) && attempt < MAX_152_ATTEMPTS) {
    console.warn(
      `[ingest-worker] error 152 video=${videoId} attempt=${attempt}/${MAX_152_ATTEMPTS} — requeue (possible session block)`
    );
    await streamStatusStore.requeueForRetry(videoId, quality, { attemptCount: attempt, err });
    return;
  }

  console.error(
    `[ingest-worker] failed video=${videoId} attempt=${attempt}: ${err?.message || err}`
  );
  await streamStatusStore.markFailed(videoId, quality, err);
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

  console.log(
    `[ingest-worker] processing video=${videoId} quality=${quality} attempt=${(Number(job.attempt_count) || 0) + 1} worker=${WORKER_ID}`
  );

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
    await handleIngestFailure(job, err);
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

    if (shuttingDown) break;
    const delayMs = randomJobDelayMs();
    if (delayMs > 0) {
      console.log(`[ingest-worker] pacing ${Math.round(delayMs / 1000)}s before next job (slot=${slot})`);
      await sleep(delayMs);
    }
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
    `[ingest-worker] started id=${WORKER_ID} concurrency=${MAX_CONCURRENT} pollMs=${POLL_MS}` +
      ` jobDelayMs=${JOB_DELAY_MIN_MS}-${JOB_DELAY_MAX_MS} max152Attempts=${MAX_152_ATTEMPTS}`
  );

  const proxyMode = ingestYtdlp.describeProxyMode();
  if (proxyMode.configured) {
    console.log(
      `[ingest-worker] yt-dlp proxy: ${proxyMode.endpoint} mode=${proxyMode.mode}` +
        ` source=${proxyMode.source} retries=${proxyMode.maxRetries} delayMs=${proxyMode.retryDelayMs}`
    );
  } else {
    console.warn(
      '[ingest-worker] yt-dlp proxy: (none) — set YT_DLP_PROXY_* env vars; datacenter egress will be bot-blocked'
    );
  }

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
