'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let streamStatusStoreModule = null;
function getStreamStatusStore() {
  if (!streamStatusStoreModule) {
    streamStatusStoreModule = require('./stream-status-store.cjs');
  }
  return streamStatusStoreModule;
}

const SERVER_DIR = __dirname;
const YT_DLP_TIMEOUT_MS = Number(process.env.YT_DLP_TIMEOUT_MS || 90_000);
const YT_DLP_PROBE_TIMEOUT_MS = Number(process.env.YT_DLP_PROBE_TIMEOUT_MS || 90_000);
const YT_DLP_LONG_TIMEOUT_MS = Number(process.env.YT_DLP_LONG_TIMEOUT_MS || 300_000);
/** Webshare backbone / backconnect rotation endpoint (not ap.webshare.io). */
const WEBSHARE_BACKCONNECT_HOST = 'p.webshare.io';
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
/** Rotated-IP retries per profile when yt-dlp reports "Error code: 152" (suspected session block). */
const YT_DLP_152_ROTATE_RETRIES = Math.max(
  0,
  Number(process.env.YT_DLP_152_ROTATE_RETRIES || 1)
);
/** Retries for transient network/SSL drops (works with or without a proxy). */
const YT_DLP_TRANSIENT_MAX_RETRIES = Math.max(
  0,
  Number(process.env.YT_DLP_TRANSIENT_MAX_RETRIES || 3)
);
const YT_DLP_RETRY_BACKOFF_MAX_MS = Math.max(
  1000,
  Number(process.env.YT_DLP_RETRY_BACKOFF_MAX_MS || 30_000)
);
/** Socket timeout (seconds) — generous default for proxy handshake latency. */
const YT_DLP_SOCKET_TIMEOUT_SEC = Math.max(
  5,
  Number(process.env.YT_DLP_SOCKET_TIMEOUT_SEC || 60)
);
/** Set YT_DLP_DYNAMIC_UA=0 to pin the static per-profile user agents. */
const YT_DLP_DYNAMIC_UA =
  process.env.YT_DLP_DYNAMIC_UA !== '0' && process.env.YT_DLP_DYNAMIC_UA !== 'false';

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

/** Last proxy endpoint printed to the log (sanitized) — avoids log spam per spawn. */
let lastLoggedProxyEndpoint = null;

function logResolvedProxyOnce(proxyUrl, source) {
  const endpoint = proxyUrl ? proxyForLog(proxyUrl) : '(none)';
  if (endpoint === lastLoggedProxyEndpoint) return;
  lastLoggedProxyEndpoint = endpoint;
  if (proxyUrl) {
    console.log(`[ingest-ytdlp] yt-dlp proxy: ${endpoint} source=${source}`);
  } else {
    console.warn(
      '[ingest-ytdlp] yt-dlp proxy: (none) — set YT_DLP_PROXY_* env vars (datacenter egress will be bot-blocked)'
    );
  }
}

function proxySourceFromEnv() {
  if (String(process.env.YT_DLP_PROXY || '').trim()) return 'YT_DLP_PROXY';
  if (String(process.env.YT_DLP_PROXY_HOST || '').trim()) return 'YT_DLP_PROXY_* components';
  if (String(process.env.HTTPS_PROXY || process.env.https_proxy || '').trim()) return 'HTTPS_PROXY (fallback)';
  if (String(process.env.HTTP_PROXY || process.env.http_proxy || '').trim()) return 'HTTP_PROXY (fallback)';
  return 'none';
}

/**
 * Resolve proxy URL at call time (not module load) so env is always fresh.
 * Priority: YT_DLP_PROXY (use %40 instead of @ if the dashboard strips @),
 * then YT_DLP_PROXY_SCHEME/USER/PASSWORD/HOST/PORT components (recommended on Render),
 * then global HTTPS_PROXY/HTTP_PROXY as a fallback so session rotation still works
 * even when only the generic env vars are set.
 *
 * @param {object} [opts]
 * @param {number} [opts.attempt=0] — >0 injects a new session ID for rotating/backconnect pools.
 */
function resolveYtDlpProxy({ attempt = 0 } = {}) {
  const portEnv = String(process.env.YT_DLP_PROXY_PORT || '').trim();
  const direct = String(process.env.YT_DLP_PROXY || '').trim();

  if (direct) {
    const resolved = modifyProxyUrlForAttempt(
      applyProxyPortFallback(normalizeProxyUrl(direct), portEnv),
      attempt
    );
    if (attempt === 0) logResolvedProxyOnce(resolved, 'YT_DLP_PROXY');
    return resolved;
  }

  const hostRaw = normalizeWebshareProxyHost(String(process.env.YT_DLP_PROXY_HOST || '').trim());
  if (!hostRaw) {
    // Fallback: generic proxy env vars — normalize + rotate like YT_DLP_PROXY.
    const generic = String(
      process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        ''
    ).trim();
    if (!generic) {
      if (attempt === 0) logResolvedProxyOnce('', 'none');
      return '';
    }
    const resolved = modifyProxyUrlForAttempt(
      applyProxyPortFallback(normalizeProxyUrl(generic), portEnv),
      attempt
    );
    if (attempt === 0) logResolvedProxyOnce(resolved, 'HTTP(S)_PROXY fallback');
    return resolved;
  }

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

  const resolved = modifyProxyUrlForAttempt(
    buildProxyUrlFromParts({
      scheme,
      user,
      pass,
      host,
      port: effectivePort,
    }),
    attempt
  );
  if (attempt === 0) logResolvedProxyOnce(resolved, 'YT_DLP_PROXY_* components');
  return resolved;
}

function describeProxyMode() {
  const proxyUrl = resolveYtDlpProxy();
  const source = proxySourceFromEnv();
  if (!proxyUrl) {
    return { configured: false, mode: 'none', endpoint: '(none)', source, maxRetries: 0 };
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
    source,
    maxRetries: YT_DLP_PROXY_MAX_RETRIES,
    retryDelayMs: YT_DLP_PROXY_RETRY_DELAY_MS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWebshareProxyHost(host) {
  const value = String(host || '').trim();
  if (!value) return value;
  if (!/ap\.webshare\.io/i.test(value)) return value;
  const fixed = value.replace(/ap\.webshare\.io/gi, WEBSHARE_BACKCONNECT_HOST);
  console.warn(
    `[ingest-ytdlp] proxy host ap.webshare.io → ${WEBSHARE_BACKCONNECT_HOST} (backconnect rotation)`
  );
  return fixed;
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

  if (/ap\.webshare\.io/i.test(value)) {
    value = value.replace(/ap\.webshare\.io/gi, WEBSHARE_BACKCONNECT_HOST);
    console.warn(
      `[ingest-ytdlp] proxy URL host ap.webshare.io → ${WEBSHARE_BACKCONNECT_HOST}`
    );
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

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Random, modern desktop browser User-Agent (Chrome / Firefox / Safari) per request.
 * Only used for browser-based profiles — app clients (ios, tv) keep their native
 * UA strings, because a browser UA on an app player_client is itself a bot signal.
 */
function randomBrowserUserAgent() {
  const pick = randomInt(0, 5);
  const chromeMajor = randomInt(130, 137);
  const firefoxMajor = randomInt(133, 139);
  const safariMinor = randomInt(3, 5);

  switch (pick) {
    case 0: // Chrome on Windows
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
    case 1: // Chrome on macOS
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
    case 2: // Chrome on Linux
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
    case 3: // Firefox on Windows
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${firefoxMajor}.0) Gecko/20100101 Firefox/${firefoxMajor}.0`;
    case 4: // Firefox on Linux
      return `Mozilla/5.0 (X11; Linux x86_64; rv:${firefoxMajor}.0) Gecko/20100101 Firefox/${firefoxMajor}.0`;
    default: // Safari on macOS
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.${safariMinor} Safari/605.1.15`;
  }
}

/** Random modern Chrome-on-Android UA for android browser-style profiles. */
function randomAndroidUserAgent() {
  const chromeMajor = randomInt(130, 137);
  const devices = ['Pixel 7', 'Pixel 8', 'SM-G998B', 'SM-S918B', 'Pixel 6a'];
  const device = devices[randomInt(0, devices.length - 1)];
  return `Mozilla/5.0 (Linux; Android ${randomInt(12, 15)}; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.6099.230 Mobile Safari/537.36`;
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
    uaKind: 'android',
    referer: 'https://www.youtube.com/',
  },
  {
    name: 'tv_embedded+mediaconnect',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=tv_embedded,mediaconnect',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    uaKind: 'native',
    referer: 'https://www.youtube.com/tv',
  },
  {
    name: 'ios',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=ios',
    userAgent:
      'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)',
    uaKind: 'native',
    referer: 'https://www.youtube.com/',
  },
  {
    name: 'android',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=android;player_skip=webpage',
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    uaKind: 'android',
    referer: 'https://m.youtube.com/',
  },
  {
    name: 'web_embedded',
    videoUrl: (videoId) => `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=web_embedded',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    uaKind: 'browser',
    referer: 'https://www.google.com/',
  },
  // Last-resort desktop browser profile — tried before the worker requeues a 152.
  {
    name: 'web_browser',
    videoUrl: (videoId) => `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    extractorArgs: 'youtube:player_client=web',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    uaKind: 'browser',
    referer: 'https://www.google.com/',
  },
];

/** Per-request UA: random modern browser UA for browser/android profiles, native UA otherwise. */
function userAgentForProfile(profile = {}) {
  if (BROWSER_USER_AGENT) return BROWSER_USER_AGENT;
  if (!YT_DLP_DYNAMIC_UA) return profile.userAgent || null;
  if (profile.uaKind === 'browser') return randomBrowserUserAgent();
  if (profile.uaKind === 'android') return randomAndroidUserAgent();
  return profile.userAgent || null;
}

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
  // Prefer pre-encoded h264/aac progressive MP4 — Bunny can segment it without
  // a full re-encode, which makes early-play kick in much sooner.
  return (
    `best[height<=${height}][ext=mp4][vcodec^=avc1][acodec^=mp4a]/` +
    `best[height<=${height}][ext=mp4]/` +
    `best[height<=${height}]/18/best[ext=mp4]/best`
  );
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
    // IPv6 routing on Render/cloud egress causes SSL handshake EOFs; pin IPv4.
    '--force-ipv4',
    // Proxy CONNECT tunnels can present intermediate certs; don't fail the handshake.
    '--no-check-certificate',
    '--extractor-retries',
    '3',
    '--socket-timeout',
    String(YT_DLP_SOCKET_TIMEOUT_SEC),
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

  const userAgent = userAgentForProfile(profile);
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

function isProxyConnectionRefusedError(err) {
  if (!err) return false;
  if (err.exitCode === 111) return true;
  if (err.proxyConnectionRefused) return true;
  if (err.spawnErrno === 'ECONNREFUSED' || err.spawnErrno === 111) return true;
  const blob = `${err.message} ${err.stderr || ''}`.toLowerCase();
  return /connection refused|errno 111|econnrefused|\[errno 111\]/i.test(blob);
}

/** YouTube permanent unavailable (not proxy/network) — yt-dlp prints "Error code: 152". */
function isYtDlpErrorCode152Unavailable(err) {
  if (!err) return false;
  if (err.ytDlpErrorCode152Unavailable) return true;
  const blob = `${err.message} ${err.stderr || ''} ${err.stdout || ''}`;
  return /error code:\s*152/i.test(blob);
}

function tagYtDlpErrorFlags(err) {
  if (!err) return err;
  err.ytDlpErrorCode152Unavailable = isYtDlpErrorCode152Unavailable(err);
  if (err.ytDlpErrorCode152Unavailable) {
    err.youtubeBotBlock = false;
    err.fileNotReady = false;
  } else {
    err.youtubeBotBlock = err.youtubeBotBlock || isYoutubeBotOrBlockError(err);
  }
  err.proxyConnectionRefused = isProxyConnectionRefusedError(err);
  return err;
}

function markSupabaseFailedImmediately(videoId, quality, err) {
  if (!videoId) return;
  // The queue worker requeues 152 (possible session block) up to N attempts and
  // owns the final failed/queued decision — don't short-circuit it here.
  if (process.env.YT_DLP_DEFER_FAILURE_MARKING === '1') {
    console.warn(
      `[ingest-ytdlp] Error code: 152 video=${videoId} — deferring failure decision to worker`
    );
    return;
  }
  console.error(
    `[ingest-ytdlp] permanent video unavailable (Error code: 152) video=${videoId} — Supabase status=failed`
  );
  void getStreamStatusStore().markFailed(videoId, quality || '360p', err);
}

function isYoutubeBotOrBlockError(err) {
  if (isYtDlpErrorCode152Unavailable(err)) return false;
  if (err && err.exitCode === 152) return true;

  const blob = `${err.message} ${err.stderr || ''} ${err.stdout || ''}`.toLowerCase();
  return (
    /sign in to confirm|not a bot|confirm you're not a bot|bot check|cookies-from-browser/i.test(
      blob
    ) ||
    /http error 403|unable to extract player data|player response/i.test(blob) ||
    /n challenge solving failed|challenge solver script.*skipped/i.test(blob)
  );
}

function isProxyRetriableError(err) {
  if (!err || isNonRetriableYoutubeError(err)) return false;
  if (isYtDlpErrorCode152Unavailable(err)) return false;
  if (err.exitCode === 152) return true;
  if (err.exitCode === 111 || isProxyConnectionRefusedError(err)) return true;
  if (err.youtubeBotBlock || isYoutubeBotOrBlockError(err)) return true;
  return false;
}

/** Transient connection drops (SSL EOF, resets, read timeouts) — retriable even without a proxy. */
function isTransientNetworkError(err) {
  if (!err || isNonRetriableYoutubeError(err)) return false;
  if (isYtDlpErrorCode152Unavailable(err)) return false;
  const blob = `${err.message} ${err.stderr || ''}`.toLowerCase();
  return /unexpected_eof_while_reading|ssleoferror|ssl:\s*unexpected_eof|eof occurred in violation of protocol|ssl handshake|handshake operation timed out|connection reset|econnreset|read timed out|the read operation timed out|remote end closed connection|incompleteread|transport endpoint|temporary failure in name resolution|getaddrinfo failed/i.test(
    blob
  );
}

/** Exponential backoff with jitter: base × 2^attempt, capped; extra padding for connection refused. */
function proxyRetryDelayMs(err, attempt = 0) {
  const exp = Math.min(
    YT_DLP_RETRY_BACKOFF_MAX_MS,
    YT_DLP_PROXY_RETRY_DELAY_MS * Math.pow(2, Math.max(0, attempt))
  );
  if (isProxyConnectionRefusedError(err)) {
    return exp + 2000 + Math.floor(Math.random() * 1500);
  }
  return exp + Math.floor(Math.random() * 500);
}

function proxyAttemptCount() {
  return resolveYtDlpProxy() ? YT_DLP_PROXY_MAX_RETRIES + 1 : 1;
}

function isNonRetriableYoutubeError(err) {
  if (isYtDlpErrorCode152Unavailable(err)) return true;
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
        tagYtDlpErrorFlags(err);
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

function profilesInOrder(videoId, profileHint = null) {
  const profiles = profilesForVideo(videoId);
  const hint = String(profileHint || '').trim();
  if (!hint) return profiles;
  const preferred = profiles.filter((p) => p.name === hint);
  const rest = profiles.filter((p) => p.name !== hint);
  return preferred.length > 0 ? [...preferred, ...rest] : profiles;
}

/**
 * Run yt-dlp with rotating-proxy retries (new egress IP per attempt) and
 * YouTube client-profile fallback (embed / TV / iOS / Android).
 * @returns {{ stdout: string, stderr: string, profile: string }}
 */
async function runYtDlp(
  extraArgs,
  {
    timeoutMs = YT_DLP_TIMEOUT_MS,
    label = 'yt-dlp',
    videoId,
    profileHint = null,
    quality = '360p',
  } = {}
) {
  const binary = resolveYtDlpBinary();
  const profiles = profilesInOrder(videoId, profileHint);
  const useSingleProfile = YT_DLP_DISABLE_PROFILE_FALLBACK || profiles.length === 1;
  const proxyAttempts = proxyAttemptCount();
  const hasProxy = proxyAttempts > 1;

  let lastErr = null;
  // Shared budget of forced IP re-rotations for "Error code: 152" across all profiles.
  let rotate152Used = 0;
  // Transient network/SSL drops retry even without a proxy configured.
  const maxAttemptsPerProfile = Math.max(proxyAttempts, YT_DLP_TRANSIENT_MAX_RETRIES + 1);

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const targetUrl = profile.videoUrl(videoId);

    for (let attempt = 0; attempt < maxAttemptsPerProfile; attempt++) {
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
        return { stdout: result.stdout, stderr: result.stderr, profile: profile.name };
      } catch (err) {
        tagYtDlpErrorFlags(err);
        lastErr = err;

        if (err.ytDlpErrorCode152Unavailable) {
          // 152 may be a session-level soft block. Force a proxy IP re-rotation
          // first, then fall through to the next profile (web_browser last)
          // before giving up and letting the worker requeue.
          const canRotate152 =
            hasProxy && rotate152Used < YT_DLP_152_ROTATE_RETRIES && attempt < proxyAttempts - 1;
          if (canRotate152) {
            rotate152Used++;
            const delayMs = proxyRetryDelayMs(err, attempt);
            console.warn(
              `[ingest-ytdlp] video=${videoId} profile=${profile.name} Error code: 152` +
                ` — forcing proxy IP re-rotation (${rotate152Used}/${YT_DLP_152_ROTATE_RETRIES}) in ${delayMs}ms` +
                ` proxy=${proxyForLog(resolveYtDlpProxy({ attempt: attempt + 1 }))}`
            );
            await sleep(delayMs);
            continue;
          }
          if (!useSingleProfile && i < profiles.length - 1) {
            console.warn(
              `[ingest-ytdlp] video=${videoId} profile=${profile.name} Error code: 152` +
                ` — falling back to next profile (${profiles[i + 1].name})`
            );
            break;
          }
          markSupabaseFailedImmediately(videoId, quality, err);
          throw err;
        }

        if (isNonRetriableYoutubeError(err)) {
          throw err;
        }

        const transientNetwork = isTransientNetworkError(err);
        const canRetryProxy =
          hasProxy && attempt < proxyAttempts - 1 && isProxyRetriableError(err);
        const canRetryTransient = transientNetwork && attempt < YT_DLP_TRANSIENT_MAX_RETRIES;

        if (canRetryProxy || canRetryTransient) {
          const delayMs = proxyRetryDelayMs(err, attempt);
          const reason = transientNetwork
            ? 'transient network/SSL drop'
            : err.exitCode === 111 || err.proxyConnectionRefused
              ? 'proxy connection refused'
              : 'bot/block';
          console.warn(
            `[ingest-ytdlp] video=${videoId} profile=${profile.name}` +
              ` ${reason} (exit=${err.exitCode ?? '?'})` +
              ` — retry ${attempt + 2}/${maxAttemptsPerProfile} (backoff ${delayMs}ms)` +
              (hasProxy
                ? ` proxy=${proxyForLog(resolveYtDlpProxy({ attempt: attempt + 1 }))}`
                : '')
          );
          await sleep(delayMs);
          continue;
        }

        if (useSingleProfile) {
          throw err;
        }

        if (!isYoutubeBotOrBlockError(err) && !transientNetwork && i === 0 && attempt === 0) {
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

function ytDlpJsonIndicatesError(data) {
  if (!data || typeof data !== 'object') return false;
  if (data._type === 'error' || data.error) return true;
  return false;
}

function assertYtDlpJsonNotError(data, videoId) {
  if (!ytDlpJsonIndicatesError(data)) return;
  const detail = String(data.error || data.message || 'unknown yt-dlp JSON error').slice(0, 400);
  const err = new Error(`yt-dlp JSON error for ${videoId}: ${detail}`);
  if (/error code:\s*152/i.test(detail)) {
    err.ytDlpErrorCode152Unavailable = true;
    err.exitCode = 152;
  } else if (/152|bot|not a bot/i.test(detail)) {
    err.exitCode = 152;
    err.youtubeBotBlock = true;
  }
  throw err;
}

function validateFetchableMediaUrl(url, videoId) {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    throw new Error(`Invalid media URL for ${videoId}: empty`);
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    throw new Error(`Invalid media URL for ${videoId}: received JSON instead of media URL`);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid media URL for ${videoId}: not http(s)`);
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid media URL for ${videoId}: malformed URL`);
  }
  if (!parsed.hostname || parsed.hostname === 'localhost') {
    throw new Error(`Invalid media URL for ${videoId}: invalid hostname`);
  }
  return trimmed;
}

function extractUrlFromYtDlpJson(data, quality = '360p') {
  if (!data || typeof data !== 'object') return null;
  if (ytDlpJsonIndicatesError(data)) return null;

  if (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) {
    return data.url;
  }

  const height = parseInt(String(quality || '360p'), 10) || 360;
  const formats =
    Array.isArray(data.requested_formats) && data.requested_formats.length > 0
      ? data.requested_formats
      : Array.isArray(data.formats)
        ? data.formats
        : [];

  const withUrl = formats.filter(
    (f) => f && typeof f.url === 'string' && /^https?:\/\//i.test(f.url)
  );
  if (withUrl.length === 0) return null;

  const muxedMp4 = withUrl.find(
    (f) =>
      f.ext === 'mp4' &&
      f.vcodec &&
      f.vcodec !== 'none' &&
      f.acodec &&
      f.acodec !== 'none' &&
      (!f.height || f.height <= height)
  );
  if (muxedMp4?.url) return muxedMp4.url;

  const videoOnly = withUrl
    .filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        (!f.acodec || f.acodec === 'none') &&
        (!f.height || f.height <= height)
    )
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  if (videoOnly?.url) return videoOnly.url;

  const anyMp4 = withUrl.find((f) => f.ext === 'mp4' && (!f.height || f.height <= height));
  if (anyMp4?.url) return anyMp4.url;

  return withUrl[0].url;
}

/** Parse `-g` URL lines or `--dump-single-json` format objects. */
function extractDirectMediaUrl(stdout, { quality = '360p', videoId = '?' } = {}) {
  const text = String(stdout || '').trim();
  if (!text) return null;

  const fromLines = pickDirectUrl(text);
  if (fromLines) return fromLines;

  try {
    const parsed = JSON.parse(text);
    assertYtDlpJsonNotError(parsed, videoId);
    const fromJson = extractUrlFromYtDlpJson(parsed, quality);
    if (fromJson) return fromJson;
  } catch (parseErr) {
    if (parseErr.youtubeBotBlock || parseErr.exitCode === 152) throw parseErr;
    /* not a single JSON blob */
  }

  for (const line of text.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      assertYtDlpJsonNotError(parsed, videoId);
      const fromLine = extractUrlFromYtDlpJson(parsed, quality);
      if (fromLine) return fromLine;
    } catch (lineErr) {
      if (lineErr.youtubeBotBlock || lineErr.exitCode === 152) throw lineErr;
      /* try previous line */
    }
  }

  return null;
}

/**
 * Resolve a direct, publicly fetchable media URL for Bunny ingest via yt-dlp.
 */
async function resolveVideoDownloadUrl(videoId, quality = '360p', options = {}) {
  if (!isAvailable()) {
    throw new Error(
      'yt-dlp binary not found — run `npm run download-tools` in server/ or set YT_DLP_BINARY_PATH'
    );
  }

  const format = qualityToFormat(quality);
  let timeoutMs = Number(options.timeoutMs) || YT_DLP_TIMEOUT_MS;
  let winningProfile = null;

  try {
    try {
      const probe = await runYtDlp(['--dump-single-json', '-f', format, '--skip-download'], {
        timeoutMs: Math.min(timeoutMs, YT_DLP_TIMEOUT_MS, YT_DLP_PROBE_TIMEOUT_MS),
        label: `probe video=${videoId} quality=${quality}`,
        videoId,
        quality,
      });
      winningProfile = probe.profile;

      let durationSeconds = null;
      try {
        const data = JSON.parse(probe.stdout);
        assertYtDlpJsonNotError(data, videoId);
        durationSeconds = Number.isFinite(data.duration) ? Math.round(data.duration) : null;
      } catch (parseErr) {
        tagYtDlpErrorFlags(parseErr);
        if (parseErr.ytDlpErrorCode152Unavailable) {
          markSupabaseFailedImmediately(videoId, quality, parseErr);
          throw parseErr;
        }
        if (parseErr.youtubeBotBlock || parseErr.exitCode === 152) throw parseErr;
        console.warn(
          `[ingest-ytdlp] probe JSON parse failed video=${videoId}: ${parseErr.message}`
        );
      }

      if (!options.timeoutMs) {
        if (!durationSeconds || durationSeconds > LONG_VIDEO_DURATION_SEC) {
          timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
        }
      }

      const urlFromProbe = extractDirectMediaUrl(probe.stdout, { quality, videoId });
      if (urlFromProbe) {
        const url = validateFetchableMediaUrl(urlFromProbe, videoId);
        console.log(
          `[ingest-ytdlp] direct url video=${videoId} profile=${winningProfile} source=json url=${url.slice(0, 96)}…`
        );
        return {
          url,
          quality,
          mime: 'video/mp4',
          ingestResolver: 'yt-dlp',
        };
      }

      console.warn(
        `[ingest-ytdlp] probe succeeded but no URL in JSON video=${videoId} profile=${winningProfile} — trying -g`
      );
    } catch (probeErr) {
      tagYtDlpErrorFlags(probeErr);
      if (probeErr.ytDlpErrorCode152Unavailable) {
        markSupabaseFailedImmediately(videoId, quality, probeErr);
        throw probeErr;
      }
      if (probeErr.youtubeBotBlock || probeErr.exitCode === 152) {
        throw probeErr;
      }
      console.warn(
        `[ingest-ytdlp] probe failed video=${videoId}: ${probeErr.message} — trying -g`
      );
      if (!options.timeoutMs) {
        timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
      }
    }

    const { stdout, profile } = await runYtDlp(['-g', '-f', format], {
      timeoutMs,
      label: `get-url video=${videoId} quality=${quality}`,
      videoId,
      profileHint: winningProfile,
      quality,
    });

    const extracted = extractDirectMediaUrl(stdout, { quality, videoId });
    if (!extracted) {
      const err = new Error(
        `yt-dlp returned no direct media URL for ${videoId} (profile=${profile || winningProfile || '?'})`
      );
      err.stdout = stdout;
      console.error(`[ingest-ytdlp] ${err.message}`);
      if (stdout) {
        console.error(
          `[ingest-ytdlp] stdout preview video=${videoId}: ${String(stdout).slice(0, 400)}`
        );
      }
      throw err;
    }

    const url = validateFetchableMediaUrl(extracted, videoId);

    console.log(
      `[ingest-ytdlp] direct url video=${videoId} profile=${profile || winningProfile} source=-g url=${url.slice(0, 96)}…`
    );

    return {
      url,
      quality,
      mime: 'video/mp4',
      ingestResolver: 'yt-dlp',
    };
  } catch (err) {
    tagYtDlpErrorFlags(err);
    if (err.ytDlpErrorCode152Unavailable) {
      markSupabaseFailedImmediately(videoId, quality, err);
    }
    console.error(
      `[ingest-ytdlp] resolveVideoDownloadUrl failed video=${videoId}: ${err.message}`
    );
    if (err.stderr) console.error(`[ingest-ytdlp] stderr:\n${err.stderr}`);
    if (err.stdout) console.error(`[ingest-ytdlp] stdout:\n${String(err.stdout).slice(0, 800)}`);
    throw err;
  }
}

const YT_DLP_DOWNLOAD_TIMEOUT_MS = Number(process.env.YT_DLP_DOWNLOAD_TIMEOUT_MS || 900_000);

/**
 * Download the video to a local file via yt-dlp (through the proxy, with the
 * full profile/retry stack). Used when the direct googlevideo URL is IP-locked
 * to the proxy and third parties (Bunny fetch) can't download it.
 * @returns {{ filePath: string, profile: string }}
 */
async function downloadVideoToFile(videoId, quality = '360p', destPath, options = {}) {
  if (!destPath) throw new Error('downloadVideoToFile requires destPath');
  const format = qualityToFormat(quality);
  const timeoutMs = Number(options.timeoutMs) || YT_DLP_DOWNLOAD_TIMEOUT_MS;

  const { profile } = await runYtDlp(
    ['-f', format, '-o', destPath, '--no-progress', '--no-part'],
    {
      timeoutMs,
      label: `download video=${videoId} quality=${quality}`,
      videoId,
      profileHint: options.profileHint || null,
      quality,
    }
  );

  if (!fs.existsSync(destPath)) {
    throw new Error(`yt-dlp download produced no file for ${videoId} (${destPath})`);
  }
  const size = fs.statSync(destPath).size;
  if (size < 50 * 1024) {
    try {
      fs.unlinkSync(destPath);
    } catch {}
    throw new Error(
      `yt-dlp download for ${videoId} is implausibly small (${size} bytes) — likely blocked`
    );
  }

  console.log(
    `[ingest-ytdlp] downloaded video=${videoId} profile=${profile} size=${(size / 1024 / 1024).toFixed(1)}MB`
  );
  return { filePath: destPath, profile };
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
  downloadVideoToFile,
  getVideoInfo,
  isAvailable,
  resolveYtDlpBinary,
  YT_DLP_TIMEOUT_MS,
  YT_DLP_PROBE_TIMEOUT_MS,
  YT_DLP_LONG_TIMEOUT_MS,
  YT_DLP_PROXY_MAX_RETRIES,
  YT_DLP_PROXY_RETRY_DELAY_MS,
  DEFAULT_YOUTUBE_PROFILES,
  randomBrowserUserAgent,
  userAgentForProfile,
  resolveYtDlpProxy,
  describeProxyMode,
  proxyForLog,
  isYoutubeBotOrBlockError,
  isProxyRetriableError,
  isTransientNetworkError,
  extractDirectMediaUrl,
  extractUrlFromYtDlpJson,
  validateFetchableMediaUrl,
  isProxyConnectionRefusedError,
  isYtDlpErrorCode152Unavailable,
};
