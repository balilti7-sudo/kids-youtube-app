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

const { ensureYtDlpBinary, updateYtDlpBinary } = require('./ensure-ytdlp.cjs');
const streamStatusStore = require('./stream-status-store.cjs');
const { runIngestPipeline } = require('./run-ingest-pipeline.cjs');
const ingestYtdlp = require('./ingest-ytdlp.cjs');
const cookiePool = require('./cookie-pool.cjs');

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
/**
 * Bunny transcode-wait timeouts requeue up to N attempts. Each retry is cheap:
 * the video is already in the Bunny library, so the worker just resumes waiting
 * (and early-play returns as soon as the first rendition is live).
 */
const MAX_TRANSCODE_ATTEMPTS = Math.max(
  1,
  Number(process.env.INGEST_MAX_TRANSCODE_ATTEMPTS || 6)
);
/** Keep the Render web bridge awake — this worker never sleeps, the web service does. */
const BRIDGE_KEEPALIVE_URL = (process.env.BRIDGE_KEEPALIVE_URL || '').trim();
const BRIDGE_KEEPALIVE_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.BRIDGE_KEEPALIVE_INTERVAL_MS || 600_000)
);
/**
 * When yt-dlp hits "Error code: 152" while a pool cookie is in use, that cookie
 * is burned and the job retries in-process with the next 'active' cookie up to
 * N times before falling back to the normal requeue/fail flow.
 */
const COOKIE_ROTATION_RETRIES = Math.max(
  0,
  Number(process.env.INGEST_COOKIE_ROTATION_RETRIES || 1)
);

function isFileNotReadyError(err) {
  if (err?.fileNotReady) return true;
  const msg = String(err?.message || err || '');
  return /transcoding not finished|file not ready|not ready after|still processing|not visible in library yet/i.test(
    msg
  );
}

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

  // Bunny is still encoding — not a failure. Requeue; next attempt resumes the
  // transcode wait directly (video already in library, no yt-dlp involved).
  if (isFileNotReadyError(err) && attempt < MAX_TRANSCODE_ATTEMPTS) {
    console.warn(
      `[ingest-worker] transcode still running video=${videoId} attempt=${attempt}/${MAX_TRANSCODE_ATTEMPTS} — requeue`
    );
    await streamStatusStore.requeueForRetry(videoId, quality, { attemptCount: attempt, err });
    return;
  }

  console.error(
    `[ingest-worker] failed video=${videoId} attempt=${attempt}: ${err?.message || err}`
  );
  await streamStatusStore.markFailed(videoId, quality, err);
}

/**
 * Claim a pool cookie for the current job: fetch it, write a temp cookies.txt
 * and point yt-dlp at it. Returns null when the pool is empty/not configured.
 */
async function acquirePoolCookie(excludeIds = []) {
  const cookie = await cookiePool.fetchActiveCookie({ excludeIds });
  if (!cookie) return null;
  const filePath = cookiePool.writeCookieTempFile(cookie.cookieContent, cookie.id);
  ingestYtdlp.setSessionCookieFile(filePath);
  console.log(
    `[ingest-worker] using pool cookie id=${cookie.id}${cookie.label ? ` label=${cookie.label}` : ''}`
  );
  return { ...cookie, filePath };
}

function releasePoolCookie(cookie) {
  ingestYtdlp.setSessionCookieFile(null);
  if (cookie?.filePath) cookiePool.cleanupCookieFile(cookie.filePath);
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

  const triedCookieIds = [];
  let cookie = null;
  if (cookiePool.isConfigured()) {
    cookie = await acquirePoolCookie();
    if (!cookie) {
      // Pool empty (or all burned) — fall back to static YT_DLP_COOKIES_FILE / no cookies.
      console.warn(
        '[ingest-worker] cookie pool has no active cookies — running with env/static cookie fallback'
      );
    }
  }

  try {
    for (let rotation = 0; ; rotation++) {
      try {
        const resolved = await runIngestPipeline(videoId, quality, { progress });
        await streamStatusStore.markReady(videoId, quality, {
          playbackUrl: resolved.url,
          bunnyGuid: resolved.bunnyGuid,
        });
        console.log(
          `[ingest-worker] ready video=${videoId} guid=${resolved.bunnyGuid || '?'} url=${resolved.url.slice(0, 96)}…`
        );
        return;
      } catch (err) {
        const is152 = ingestYtdlp.isYtDlpErrorCode152Unavailable(err);

        // A 152 while a pool cookie was active burns that cookie and, budget
        // permitting, retries immediately with the next active cookie.
        if (is152 && cookie) {
          triedCookieIds.push(cookie.id);
          await cookiePool.burnCookie(cookie.id, `yt-dlp 152 on video ${videoId}`);
          releasePoolCookie(cookie);
          cookie = null;

          if (rotation < COOKIE_ROTATION_RETRIES) {
            cookie = await acquirePoolCookie(triedCookieIds);
            if (cookie) {
              console.warn(
                `[ingest-worker] 152 with burned cookie — retrying video=${videoId} with next pool cookie (rotation ${rotation + 1}/${COOKIE_ROTATION_RETRIES})`
              );
              continue;
            }
            console.error(
              '[ingest-worker] CRITICAL: cookie pool EXHAUSTED — all youtube_cookies are burned. ' +
                'Replenish the pool (insert new active rows) to restore cookie rotation.'
            );
          }
        }

        await handleIngestFailure(job, err);
        return;
      }
    }
  } finally {
    releasePoolCookie(cookie);
  }
}

/**
 * Publish this worker's egress diagnostics to Supabase so the bridge
 * /api/diagnostics can show the WORKER's proxy IP (Render workers serve no HTTP).
 */
async function publishDiagnostics() {
  try {
    const diag = await ingestYtdlp.runEgressDiagnostics();
    await streamStatusStore.saveWorkerDiagnostics(WORKER_ID, { workerId: WORKER_ID, ...diag });
    const eg = diag.egress?.viaProxy;
    console.log(
      `[ingest-worker] diagnostics published proxyWorking=${diag.proxy.working}` +
        ` egressIp=${eg?.ip || eg?.error || '?'} ytDlp=${diag.ytDlpVersion || '?'}`
    );
  } catch (err) {
    console.warn(`[ingest-worker] diagnostics publish failed: ${err?.message || err}`);
  }
}

function startDiagnosticsPublisher() {
  const timer = setInterval(() => void publishDiagnostics(), BRIDGE_KEEPALIVE_INTERVAL_MS);
  timer.unref?.();
}

function startBridgeKeepAlive() {
  if (!BRIDGE_KEEPALIVE_URL) {
    console.log('[ingest-worker] bridge keep-alive disabled (BRIDGE_KEEPALIVE_URL not set)');
    return;
  }

  const ping = async () => {
    try {
      const res = await fetch(BRIDGE_KEEPALIVE_URL, {
        signal: AbortSignal.timeout(45_000),
        headers: { 'user-agent': `safetube-ingest-worker/${WORKER_ID}` },
      });
      console.log(`[ingest-worker] keep-alive → ${res.status} (${BRIDGE_KEEPALIVE_URL})`);
    } catch (err) {
      // Cold start can exceed the timeout — the ping itself still wakes the dyno.
      console.warn(`[ingest-worker] keep-alive ping failed: ${err?.message || err}`);
    }
  };

  void ping();
  const timer = setInterval(() => void ping(), BRIDGE_KEEPALIVE_INTERVAL_MS);
  timer.unref?.();
  console.log(
    `[ingest-worker] bridge keep-alive every ${Math.round(BRIDGE_KEEPALIVE_INTERVAL_MS / 60000)}min → ${BRIDGE_KEEPALIVE_URL}`
  );
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

  // Best-effort: keep pace with YouTube extractor changes (YT_DLP_AUTO_UPDATE=0 to skip).
  if (process.env.YT_DLP_AUTO_UPDATE !== '0' && process.env.YT_DLP_AUTO_UPDATE !== 'false') {
    updateYtDlpBinary();
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

  if (cookiePool.isConfigured()) {
    const activeCookies = await cookiePool.countActiveCookies();
    if (activeCookies > 0) {
      console.log(
        `[ingest-worker] cookie pool: ${activeCookies} active cookie(s), rotationRetries=${COOKIE_ROTATION_RETRIES}`
      );
    } else {
      console.warn(
        '[ingest-worker] cookie pool: 0 active cookies — insert rows into youtube_cookies to enable rotation'
      );
    }
  }

  publishDiagnostics();

  startBridgeKeepAlive();
  startDiagnosticsPublisher();

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
