'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const YT_DLP_TIMEOUT_MS = Number(process.env.YT_DLP_TIMEOUT_MS || 90_000);
const YT_DLP_LONG_TIMEOUT_MS = Number(process.env.YT_DLP_LONG_TIMEOUT_MS || 300_000);
const LONG_VIDEO_DURATION_SEC = Number(process.env.LONG_VIDEO_DURATION_SEC || 65);
const YT_DLP_COOKIES_FILE = (process.env.YT_DLP_COOKIES_FILE || '').trim();
const YT_DLP_FORMAT = (process.env.YT_DLP_FORMAT || '').trim();
const YT_DLP_EXTRACTOR_ARGS = (
  process.env.YT_DLP_EXTRACTOR_ARGS ||
  process.env.YT_DLP_PRIMARY_EXTRACTOR_ARGS ||
  ''
).trim();
const YT_DLP_PLUGIN_DIRS = (
  process.env.YT_DLP_PLUGIN_DIRS || path.join(SERVER_DIR, 'yt-dlp-plugins')
).trim();
const YT_DLP_EXTRA_ARGS = (process.env.YT_DLP_EXTRA_ARGS || '').trim();
const BROWSER_USER_AGENT = (
  process.env.BROWSER_USER_AGENT || process.env.MEDIA_USER_AGENT || ''
).trim();
const YT_DLP_REMOTE_COMPONENTS = (
  process.env.YT_DLP_REMOTE_COMPONENTS || 'ejs:github'
).trim();
const YT_DLP_JS_RUNTIMES = (process.env.YT_DLP_JS_RUNTIMES || 'node').trim();
const YT_DLP_DISABLE_PROFILE_FALLBACK =
  process.env.YT_DLP_DISABLE_PROFILE_FALLBACK === '1' ||
  process.env.YT_DLP_DISABLE_PROFILE_FALLBACK === 'true';
/** Retries after the first attempt when proxy is configured (bot block / exit 152). */
const YT_DLP_PROXY_MAX_RETRIES = Math.max(
  0,
  Number(process.env.YT_DLP_PROXY_MAX_RETRIES || 4)
);
const YT_DLP_PROXY_RETRY_DELAY_MS = Math.max(
  0,
  Number(process.env.YT_DLP_PROXY_RETRY_DELAY_MS || 1200)
);

/**
 * Split host:port when YT_DLP_PROXY_HOST includes a trailing port.
 */
function parseProxyHostPort(hostRaw, portRaw) {
  const portFromEnv = String(portRaw || '').trim();
  let host = String(hostRaw || '').trim();
  if (!host) return { host: '', port: portFromEnv };

  // IPv6 [::1]:port — leave unchanged; port comes from env or bracket form.
  if (host.startsWith('[')) {
    return { host, port: portFromEnv };
  }

  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount === 1) {
    const idx = host.indexOf(':');
    const maybePort = host.slice(idx + 1);
    if (/^\d+$/.test(maybePort)) {
      return { host: host.slice(0, idx), port: portFromEnv || maybePort };
    }
  }

  return { host, port: portFromEnv };
}

/**
 * True when the hostname segment already ends with :port (not bare IPv6 brackets).
 */
function proxyHostHasExplicitPort(proxyUrl) {
  const afterAuth = proxyUrl.replace(/^https?:\/\/(?:[^@/]+@)?/i, '');
  const hostPart = afterAuth.split('/')[0].split('?')[0].split('#')[0];
  if (hostPart.startsWith('[')) {
    return /^\[[^\]]+\]:\d+$/.test(hostPart);
  }
  return /:\d+$/.test(hostPart);
}

/**
 * Append :port to the proxy hostname using string assembly.
 * The URL API omits default ports (:80 / :443), which breaks Webshare backconnect on Render.
 */
function applyProxyPortFallback(proxyUrl, portOverride = '') {
  if (!proxyUrl) return '';

  const port = String(portOverride || process.env.YT_DLP_PROXY_PORT || '').trim();
  if (!port) return proxyUrl;
  if (proxyHostHasExplicitPort(proxyUrl)) return proxyUrl;

  return proxyUrl.replace(
    /^(https?:\/\/(?:[^@/]+@)?)([^/?#]+)(.*)$/i,
    (_, prefix, hostname, suffix) => `${prefix}${hostname}:${port}${suffix}`
  );
}

function buildProxyUrlFromParts({ scheme, user, pass, host, port }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  return applyProxyPortFallback(`${scheme}://${auth}${host}`, port);
}

function randomProxySessionId() {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(-12);
}

/** Webshare `-rotate` already assigns a new IP per connection; cannot combine with session IDs. */
function isWebshareRotatingUsername(username) {
  const value = String(username || '').trim();
  return /(?:^|-)rotate(?:-|$)/i.test(value);
}

/**
 * Append a sticky-session suffix so backconnect gateways issue a fresh egress IP.
 * Skipped when the username already uses Webshare rotate mode.
 */
function usernameForProxyAttempt(baseUser, attempt) {
  const user = String(baseUser || '').trim();
  if (!user || attempt <= 0 || isWebshareRotatingUsername(user)) {
    return user;
  }
  return `${user}-${randomProxySessionId()}`;
}

function modifyProxyUrlForAttempt(proxyUrl, attempt) {
  if (!proxyUrl || attempt <= 0) return proxyUrl;

  const match = proxyUrl.match(/^(https?:\/\/)([^@]+)@(.+)$/i);
  if (!match) return proxyUrl;

  const [, scheme, authPart, hostPart] = match;
  const colonIdx = authPart.indexOf(':');
  if (colonIdx < 0) return proxyUrl;

  const user = decodeURIComponent(authPart.slice(0, colonIdx));
  const pass = authPart.slice(colonIdx + 1);
  const nextUser = usernameForProxyAttempt(user, attempt);
  if (nextUser === user) return proxyUrl;

  return `${scheme}${encodeURIComponent(nextUser)}:${pass}@${hostPart}`;
}

/**
 * Resolve proxy URL at call time (not module load) so env is always fresh.
 * Supports YT_DLP_PROXY (use %40 instead of @ if the dashboard strips @),
 * or YT_DLP_PROXY_SCHEME/USER/PASSWORD/HOST/PORT components (recommended on Render).
 *
 * @param {object} [opts]
 * @param {number} [opts.attempt=0] — >0 injects a new session ID for rotating/backconnect pools.
 */
function resolveYtDlpProxy({ attempt = 0 } = {}) {
  const portEnv = String(process.env.YT_DLP_PROXY_PORT || '').trim();
  const direct = String(process.env.YT_DLP_PROXY || '').trim();

  if (direct) {
    return modifyProxyUrlForAttempt(
      applyProxyPortFallback(normalizeProxyUrl(direct), portEnv),
      attempt
    );
  }

  const hostRaw = String(process.env.YT_DLP_PROXY_HOST || '').trim();
  if (!hostRaw) return '';

  const scheme = String(process.env.YT_DLP_PROXY_SCHEME || 'http')
    .trim()
    .replace(/:$/, '');
  const user = usernameForProxyAttempt(
    String(process.env.YT_DLP_PROXY_USER || '').trim(),
    attempt
  );
  const pass = String(
    process.env.YT_DLP_PROXY_PASSWORD || process.env.YT_DLP_PROXY_PASS || ''
  );
  const { host, port } = parseProxyHostPort(hostRaw, portEnv);
  const effectivePort = port || portEnv;

  return modifyProxyUrlForAttempt(
    buildProxyUrlFromParts({
      scheme,
      user,
      pass,
      host,
      port: effectivePort,
    }),
    attempt
  );
}

function describeProxyMode() {
  const proxyUrl = resolveYtDlpProxy();
  if (!proxyUrl) {
    return { configured: false, mode: 'none', endpoint: '(none)', maxRetries: 0 };
  }

  let username = String(process.env.YT_DLP_PROXY_USER || '').trim();
  if (!username) {
    try {
      username = decodeURIComponent(new URL(proxyUrl).username || '');
    } catch {
      username = '';
    }
  }

  const rotating = isWebshareRotatingUsername(username);
  const mode = rotating ? 'backconnect-rotate' : 'backconnect-session';
  return {
    configured: true,
    mode,
    endpoint: proxyForLog(proxyUrl),
    maxRetries: YT_DLP_PROXY_MAX_RETRIES,
    retryDelayMs: YT_DLP_PROXY_RETRY_DELAY_MS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProxyUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';

  if (value.includes('%40')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep literal value */
    }
  }

  // Render env UIs sometimes corrupt "@" to the letter "a" immediately before an IPv4 host.
  const atCorruptionFixed = value.replace(
    /^(https?:\/\/)([^:]+):([^@/]+?)a(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i,
    (_, scheme, user, pass, ip, portSuffix = '') => {
      console.warn(
        '[ingest-ytdlp] repaired proxy URL: corrected corrupted @ (literal "a") before host IP'
      );
      return `${scheme}${user}:${pass}@${ip}${portSuffix}`;
    }
  );
  if (atCorruptionFixed !== value) {
    value = atCorruptionFixed;
  }

  // If @ was dropped entirely before an IPv4 host, re-insert it.
  if (!value.includes('@')) {
    const missingAtFixed = value.replace(
      /^(https?:\/\/)([^:]+):([^/]+?)(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i,
      (_, scheme, user, pass, ip, portSuffix = '') => {
        console.warn('[ingest-ytdlp] repaired proxy URL: inserted missing @ before host IP');
        return `${scheme}${user}:${pass}@${ip}${portSuffix}`;
      }
    );
    if (missingAtFixed !== value) {
      value = missingAtFixed;
    }
  }

  return value;
}

/** Log-friendly proxy string (never prints credentials). Preserves explicit :port in URL. */
function proxyHostFromUrl(proxyUrl) {
  const afterAuth = proxyUrl.replace(/^https?:\/\/(?:[^@/]+@)?/i, '');
  return afterAuth.split('/')[0].split('?')[0].split('#')[0];
}

function proxyForLog(proxyUrl) {
  if (!proxyUrl) return '(none)';
  const schemeMatch = proxyUrl.match(/^(https?:\/\/)/i);
  if (!schemeMatch) return '(invalid proxy URL)';
  const hasAuth = /^https?:\/\/[^@/]+@/i.test(proxyUrl);
  const host = proxyHostFromUrl(proxyUrl);
  return `${schemeMatch[1]}${hasAuth ? '***:***@' : ''}${host}`;
}

function sanitizeArgsForLog(args) {
  return args.map((arg, i, arr) => {
    if (i > 0 && arr[i - 1] === '--proxy') {
      return proxyForLog(arg);
    }
    return arg;
  });
}

/** Mobile / embed clients — best chance on datacenter IPs without browser cookies. */
const DEFAULT_YOUTUBE_PROFILES = [
  {
    name: 'android_embedded+web_embedded',
    videoUrl: (videoId) => `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
    extractorArgs:
      'youtube:player_client=android_embedded,web_embedded;player_skip=webpage,configs',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    referer: 'https://www.youtube.com/',
  },
  {
    name: 'tv_embedded+mediaconnect',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=tv_embedded,mediaconnect',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    referer: 'https://www.youtube.com/tv',
  },
  {
    name: 'ios',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=ios',
    userAgent:
      'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
    referer: 'https://www.youtube.com/',
  },
  {
    name: 'android',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=android;player_skip=webpage',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    referer: 'https://m.youtube.com/',
  },
  {
    name: 'web_embedded',
    videoUrl: (videoId) => `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=web_embedded',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    referer: 'https://www.google.com/',
  },
];

function resolveYtDlpBinary() {
  const explicit = (process.env.YT_DLP_BINARY_PATH || '').trim();
  if (explicit) return explicit;
  const local =
    process.platform === 'win32'
      ? path.join(SERVER_DIR, 'yt-dlp.exe')
      : path.join(SERVER_DIR, 'yt-dlp');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function isAvailable() {
  try {
    const binary = resolveYtDlpBinary();
    if (binary.includes(path.sep) || binary.includes('/') || binary.includes('\\')) {
      return fs.existsSync(binary);
    }
    return true;
  } catch {
    return false;
  }
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function qualityToFormat(quality) {
  if (YT_DLP_FORMAT) return YT_DLP_FORMAT;
  const height = parseInt(String(quality || '360p'), 10) || 360;
  return `best[height<=${height}][ext=mp4]/best[height<=${height}]/18/best[ext=mp4]/best`;
}

function profilesForVideo(videoId) {
  if (YT_DLP_EXTRACTOR_ARGS) {
    return [
      {
        name: 'env',
        videoUrl: () => youtubeWatchUrl(videoId),
        extractorArgs: YT_DLP_EXTRACTOR_ARGS,
        userAgent: BROWSER_USER_AGENT || null,
        referer: null,
      },
    ];
  }
  return DEFAULT_YOUTUBE_PROFILES;
}

function buildBaseArgs(profile = {}, proxyUrl = '') {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--geo-bypass',
    '--extractor-retries',
    '3',
    '--socket-timeout',
    '30',
  ];

  if (YT_DLP_PLUGIN_DIRS && fs.existsSync(YT_DLP_PLUGIN_DIRS)) {
    args.push('--plugin-dirs', YT_DLP_PLUGIN_DIRS);
  }

  if (YT_DLP_REMOTE_COMPONENTS && YT_DLP_REMOTE_COMPONENTS !== '0') {
    args.push('--remote-components', YT_DLP_REMOTE_COMPONENTS);
  }

  if (YT_DLP_JS_RUNTIMES && YT_DLP_JS_RUNTIMES !== '0') {
    args.push('--js-runtimes', YT_DLP_JS_RUNTIMES);
  }

  const effectiveProxy = proxyUrl || resolveYtDlpProxy();
  if (effectiveProxy) {
    args.push('--proxy', effectiveProxy);
  }

  const userAgent = profile.userAgent || BROWSER_USER_AGENT;
  if (userAgent) {
    args.push('--user-agent', userAgent);
  }

  if (profile.referer) {
    args.push('--add-headers', `Referer:${profile.referer}`);
  }

  if (YT_DLP_COOKIES_FILE && fs.existsSync(YT_DLP_COOKIES_FILE)) {
    args.push('--cookies', YT_DLP_COOKIES_FILE);
  }

  const extractorArgs = profile.extractorArgs || YT_DLP_EXTRACTOR_ARGS;
  if (extractorArgs) {
    args.push('--extractor-args', extractorArgs);
  }

  if (YT_DLP_EXTRA_ARGS) {
    args.push(...YT_DLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  }

  return args;
}

function isYoutubeBotOrBlockError(err) {
  if (err && err.exitCode === 152) return true;

  const blob = `${err.message} ${err.stderr || ''} ${err.stdout || ''}`.toLowerCase();
  return (
    /sign in to confirm|not a bot|confirm you're not a bot|bot check|cookies-from-browser/i.test(
      blob
    ) ||
    /http error 403|unable to extract player data|player response/i.test(blob) ||
    /n challenge solving failed|challenge solver script.*skipped/i.test(blob) ||
    /\b152\b/.test(blob)
  );
}

function isProxyRetriableError(err) {
  if (!err || isNonRetriableYoutubeError(err)) return false;
  if (err.exitCode === 152) return true;
  if (err.youtubeBotBlock || isYoutubeBotOrBlockError(err)) return true;
  return false;
}

function proxyAttemptCount() {
  return resolveYtDlpProxy() ? YT_DLP_PROXY_MAX_RETRIES + 1 : 1;
}

function isNonRetriableYoutubeError(err) {
  const blob = `${err.message} ${err.stderr || ''}`.toLowerCase();
  return (
    /private video|video unavailable|has been removed|copyright|live event|upcoming premiere|members.only|age.restricted/i.test(
      blob
    )
  );
}

function ensureYtDlpExecutable(binary) {
  if (process.platform === 'win32') return;
  if (!binary || !fs.existsSync(binary)) return;
  try {
    fs.chmodSync(binary, 0o755);
  } catch (chmodErr) {
    console.warn(`[ingest-ytdlp] chmod +x failed binary=${binary}: ${chmodErr.message}`);
  }
}

function buildYtDlpError(message, { stderr = '', stdout = '', exitCode = null, spawnErr = null } = {}) {
  const err = new Error(message);
  err.stderr = stderr;
  err.stdout = stdout;
  err.exitCode = exitCode;
  if (spawnErr) {
    err.spawnCode = spawnErr.code;
    err.spawnErrno = spawnErr.errno;
  }
  return err;
}

function logYtDlpFailure(label, binary, args, err) {
  const safeArgs = sanitizeArgsForLog(args);
  console.error(`[ingest-ytdlp] ${label} FAILED binary=${binary}`);
  console.error(`[ingest-ytdlp] ${label} args=${JSON.stringify(safeArgs)}`);
  console.error(`[ingest-ytdlp] ${label} error.message=${err.message}`);
  if (err.spawnCode) console.error(`[ingest-ytdlp] ${label} spawn.code=${err.spawnCode}`);
  if (err.spawnErrno) console.error(`[ingest-ytdlp] ${label} spawn.errno=${err.spawnErrno}`);
  if (err.exitCode != null) console.error(`[ingest-ytdlp] ${label} exitCode=${err.exitCode}`);
  if (err.stderr) console.error(`[ingest-ytdlp] ${label} stderr:\n${err.stderr}`);
  if (err.stdout) console.error(`[ingest-ytdlp] ${label} stdout:\n${err.stdout}`);
}

function runYtDlpOnce(binary, args, { timeoutMs, label, proxyUrl = '' }) {
  return new Promise((resolve, reject) => {
    const effectiveProxy = proxyUrl || resolveYtDlpProxy();
    console.log(
      `[ingest-ytdlp] ${label} spawn binary=${binary} timeout=${timeoutMs}ms proxy=${proxyForLog(effectiveProxy)}`
    );
    console.log(`[ingest-ytdlp] ${label} args=${JSON.stringify(sanitizeArgsForLog(args))}`);

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = buildYtDlpError(`yt-dlp timed out after ${timeoutMs}ms`, { stderr, stdout });
      err.fileNotReady = true;
      logYtDlpFailure(label, binary, args, err);
      finish(() => reject(err));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (spawnErr) => {
      clearTimeout(timer);
      const err = buildYtDlpError(`yt-dlp spawn failed (${binary}): ${spawnErr.message}`, {
        stderr,
        stdout,
        spawnErr,
      });
      logYtDlpFailure(label, binary, args, err);
      finish(() => reject(err));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout).trim();
        const err = buildYtDlpError(`yt-dlp exited ${code}: ${detail.slice(0, 800) || 'no output'}`, {
          stderr,
          stdout,
          exitCode: code,
        });
        err.youtubeBotBlock = isYoutubeBotOrBlockError(err);
        if (/private|unavailable|live|premiere|removed/i.test(detail)) {
          err.fileNotReady = false;
        }
        logYtDlpFailure(label, binary, args, err);
        finish(() => reject(err));
        return;
      }
      finish(() => resolve({ stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  });
}

async function runYtDlpOnceWithPermissionRetry(binary, args, opts) {
  ensureYtDlpExecutable(binary);
  try {
    return await runYtDlpOnce(binary, args, opts);
  } catch (firstErr) {
    const permissionDenied =
      firstErr.spawnCode === 'EACCES' ||
      firstErr.spawnCode === 'ENOENT' ||
      /EACCES|permission denied|not found/i.test(firstErr.message);
    if (!permissionDenied || process.platform === 'win32') {
      throw firstErr;
    }
    console.warn(`[ingest-ytdlp] ${opts.label} retrying after chmod binary=${binary}`);
    ensureYtDlpExecutable(binary);
    return runYtDlpOnce(binary, args, { ...opts, label: `${opts.label}-chmod-retry` });
  }
}

/**
 * Run yt-dlp with rotating-proxy retries (new egress IP per attempt) and
 * YouTube client-profile fallback (embed / TV / iOS / Android).
 */
async function runYtDlp(extraArgs, { timeoutMs = YT_DLP_TIMEOUT_MS, label = 'yt-dlp', videoId } = {}) {
  const binary = resolveYtDlpBinary();
  const profiles = profilesForVideo(videoId);
  const useSingleProfile = YT_DLP_DISABLE_PROFILE_FALLBACK || profiles.length === 1;
  const proxyAttempts = proxyAttemptCount();
  const hasProxy = proxyAttempts > 1;

  let lastErr = null;

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const targetUrl = profile.videoUrl(videoId);

    for (let attempt = 0; attempt < proxyAttempts; attempt++) {
      const proxyUrl = resolveYtDlpProxy({ attempt });
      const args = [...buildBaseArgs(profile, proxyUrl), ...extraArgs, targetUrl];
      const attemptSuffix =
        attempt > 0 ? ` proxy-attempt=${attempt + 1}/${proxyAttempts}` : '';
      const profileLabel = `${label} profile=${profile.name}${attemptSuffix}`;

      try {
        const result = await runYtDlpOnceWithPermissionRetry(binary, args, {
          timeoutMs,
          label: profileLabel,
          proxyUrl,
        });
        console.log(
          `[ingest-ytdlp] success video=${videoId} profile=${profile.name}` +
            (attempt > 0 ? ` proxy-attempt=${attempt + 1}` : '')
        );
        return result;
      } catch (err) {
        lastErr = err;
        err.youtubeBotBlock = err.youtubeBotBlock || isYoutubeBotOrBlockError(err);

        if (useSingleProfile || isNonRetriableYoutubeError(err)) {
          throw err;
        }

        const canRetryProxy =
          hasProxy && attempt < proxyAttempts - 1 && isProxyRetriableError(err);
        if (canRetryProxy) {
          const delayMs =
            YT_DLP_PROXY_RETRY_DELAY_MS + Math.floor(Math.random() * 500);
          console.warn(
            `[ingest-ytdlp] video=${videoId} profile=${profile.name}` +
              ` bot/block (exit=${err.exitCode ?? '?'})` +
              ` — retry ${attempt + 2}/${proxyAttempts} with new proxy IP in ${delayMs}ms` +
              ` proxy=${proxyForLog(resolveYtDlpProxy({ attempt: attempt + 1 }))}`
          );
          await sleep(delayMs);
          continue;
        }

        if (!isYoutubeBotOrBlockError(err) && i === 0 && attempt === 0) {
          throw err;
        }

        break;
      }
    }

    if (useSingleProfile) {
      break;
    }

    const remaining = profiles.length - i - 1;
    if (remaining > 0 && lastErr && isYoutubeBotOrBlockError(lastErr)) {
      console.warn(
        `[ingest-ytdlp] video=${videoId} profile=${profile.name} blocked/failed` +
          ` (${lastErr.message.slice(0, 140)})` +
          ` — trying next profile (${remaining} left)`
      );
    }
  }

  throw lastErr || new Error(`yt-dlp failed for ${videoId}`);
}

function pickDirectUrl(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
  if (lines.length === 0) return null;
  const combined = lines.find((line) => /mime=video%2Fmp4|itag=18|\.mp4/i.test(line));
  return combined || lines[0];
}

/**
 * Resolve a direct, publicly fetchable media URL for Bunny ingest via `yt-dlp -g`.
 */
async function resolveVideoDownloadUrl(videoId, quality = '360p', options = {}) {
  if (!isAvailable()) {
    throw new Error(
      'yt-dlp binary not found — run `npm run download-tools` in server/ or set YT_DLP_BINARY_PATH'
    );
  }

  const format = qualityToFormat(quality);
  let timeoutMs = Number(options.timeoutMs) || YT_DLP_TIMEOUT_MS;

  if (!options.timeoutMs) {
    try {
      const info = await getVideoInfo(videoId, { timeoutMs: Math.min(YT_DLP_TIMEOUT_MS, 45_000) });
      const duration = Number(info.lengthSeconds) || 0;
      if (duration <= 0 || duration > LONG_VIDEO_DURATION_SEC) {
        timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
      }
    } catch {
      timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
    }
  }

  const { stdout } = await runYtDlp(['-g', '-f', format], {
    timeoutMs,
    label: `get-url video=${videoId} quality=${quality}`,
    videoId,
  });

  const url = pickDirectUrl(stdout);
  if (!url) {
    throw new Error('yt-dlp returned no direct media URL');
  }

  console.log(`[ingest-ytdlp] direct url video=${videoId} url=${url.slice(0, 96)}…`);

  return {
    url,
    quality,
    mime: 'video/mp4',
    ingestResolver: 'yt-dlp',
  };
}

async function getVideoInfo(videoId, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || Math.min(YT_DLP_TIMEOUT_MS, 60_000);
  if (!isAvailable()) {
    return {
      title: null,
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }

  try {
    const { stdout } = await runYtDlp(['--dump-single-json', '--skip-download'], {
      timeoutMs,
      label: `info video=${videoId}`,
      videoId,
    });
    const data = JSON.parse(stdout);
    return {
      title: data.title || null,
      lengthSeconds: Number.isFinite(data.duration) ? Math.round(data.duration) : null,
      author: data.uploader || data.channel || null,
      ownerChannelName: data.channel || data.uploader || null,
      externalChannelId: data.channel_id || null,
      thumbnail: data.thumbnail ? [{ url: data.thumbnail }] : [],
      isLiveContent: Boolean(data.is_live),
      liveBroadcastDetails: { isLiveNow: Boolean(data.is_live) },
    };
  } catch (err) {
    console.warn(`[ingest-ytdlp] getVideoInfo failed video=${videoId}: ${err.message}`);
    if (err.stderr) console.warn(`[ingest-ytdlp] getVideoInfo stderr:\n${err.stderr}`);
    return {
      title: null,
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }
}

module.exports = {
  resolveVideoDownloadUrl,
  getVideoInfo,
  isAvailable,
  resolveYtDlpBinary,
  YT_DLP_TIMEOUT_MS,
  YT_DLP_LONG_TIMEOUT_MS,
  YT_DLP_PROXY_MAX_RETRIES,
  YT_DLP_PROXY_RETRY_DELAY_MS,
  DEFAULT_YOUTUBE_PROFILES,
  resolveYtDlpProxy,
  describeProxyMode,
  proxyForLog,
  isYoutubeBotOrBlockError,
  isProxyRetriableError,
};
