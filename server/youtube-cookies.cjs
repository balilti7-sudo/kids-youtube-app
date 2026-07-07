'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[innertube/cookies]';

/** Local fallback path (gitignored). */
const COOKIES_FILE_PATH = path.join(__dirname, 'www.youtube.com_cookies.txt');

/** @type {{ source: 'env'|'file'|null, path: string|null, mtimeMs: number, header: string, count: number, loggedIn: boolean }} */
let cache = {
  source: null,
  path: null,
  mtimeMs: 0,
  header: '',
  count: 0,
  loggedIn: false,
};

function normalizeCookiesContent(raw) {
  let content = String(raw || '').trim();
  if (!content) return '';
  // Some hosts store multiline env values with literal \n sequences.
  if (!content.includes('\n') && content.includes('\\n')) {
    content = content.replace(/\\n/g, '\n');
  }
  return content;
}

function hasEnvCookies() {
  return Boolean(normalizeCookiesContent(process.env.COOKIES_CONTENT));
}

function resolveCookiesFilePath() {
  if (fs.existsSync(COOKIES_FILE_PATH)) return COOKIES_FILE_PATH;
  return null;
}

/**
 * Parse Netscape cookies.txt into a Cookie request header value.
 * @param {string} content
 */
function netscapeToCookieHeader(content) {
  /** @type {Map<string, string>} */
  const jar = new Map();
  const nowSec = Math.floor(Date.now() / 1000);

  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;

    const expiryRaw = parts[4];
    const name = parts[5];
    const value = parts.slice(6).join('\t');
    if (!name) continue;

    const expiry = Number(expiryRaw);
    if (Number.isFinite(expiry) && expiry > 0 && expiry < nowSec) continue;

    jar.set(name, value);
  }

  return {
    header: Array.from(jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
    count: jar.size,
    loggedIn: jar.has('LOGIN_INFO') || (jar.has('SID') && jar.has('SAPISID')),
  };
}

function applyParsedCookies(parsed, meta) {
  if (!parsed.header) {
    console.warn(
      `${LOG_PREFIX} ${meta.source} source had no valid Netscape cookie rows (count=${parsed.count})`
    );
    return null;
  }

  cache = {
    source: meta.source,
    path: meta.path,
    mtimeMs: meta.revision,
    header: parsed.header,
    count: parsed.count,
    loggedIn: parsed.loggedIn,
  };

  const label =
    meta.source === 'env'
      ? 'COOKIES_CONTENT (env, priority)'
      : path.basename(meta.path || COOKIES_FILE_PATH) + ' (file fallback)';

  console.log(
    `${LOG_PREFIX} using ${label}: ${parsed.count} cookie(s)` +
      (parsed.loggedIn ? ', logged-in session' : ', anonymous/visitor only')
  );
  return cache;
}

function loadCookiesFromEnv() {
  const content = normalizeCookiesContent(process.env.COOKIES_CONTENT);
  if (!content) {
    console.log(`${LOG_PREFIX} COOKIES_CONTENT not set — will try file fallback if present`);
    return null;
  }

  const revision = Buffer.byteLength(content, 'utf8');
  if (cache.source === 'env' && cache.mtimeMs === revision) {
    return cache;
  }

  console.log(`${LOG_PREFIX} loading from COOKIES_CONTENT (${revision} bytes)`);

  try {
    const parsed = netscapeToCookieHeader(content);
    return applyParsedCookies(parsed, {
      source: 'env',
      path: null,
      revision,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} COOKIES_CONTENT parse failed: ${err?.message || err}`);
    return null;
  }
}

function loadCookiesFromFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    console.warn(`${LOG_PREFIX} file stat failed (${filePath}): ${err?.message || err}`);
    return null;
  }

  if (cache.source === 'file' && cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }

  console.log(`${LOG_PREFIX} loading from file fallback: ${filePath}`);

  try {
    const parsed = netscapeToCookieHeader(fs.readFileSync(filePath, 'utf8'));
    return applyParsedCookies(parsed, {
      source: 'file',
      path: filePath,
      revision: stat.mtimeMs,
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} file read failed (${filePath}): ${err?.message || err}`);
    return null;
  }
}

/**
 * Priority: COOKIES_CONTENT env → server/www.youtube.com_cookies.txt file.
 */
function loadCookies() {
  const fromEnv = loadCookiesFromEnv();
  if (fromEnv?.header) return fromEnv;

  if (hasEnvCookies()) {
    console.warn(
      `${LOG_PREFIX} COOKIES_CONTENT was set but unusable — falling back to www.youtube.com_cookies.txt`
    );
  }

  const filePath = resolveCookiesFilePath();
  if (filePath) {
    const fromFile = loadCookiesFromFile(filePath);
    if (fromFile?.header) return fromFile;
    console.warn(`${LOG_PREFIX} file present but no usable cookies parsed: ${filePath}`);
  } else {
    console.warn(`${LOG_PREFIX} file fallback not found: ${COOKIES_FILE_PATH}`);
  }

  cache = {
    source: null,
    path: null,
    mtimeMs: 0,
    header: '',
    count: 0,
    loggedIn: false,
  };
  console.error(
    `${LOG_PREFIX} no cookies loaded — set COOKIES_CONTENT on Render or add www.youtube.com_cookies.txt`
  );
  return cache;
}

function getCookieHeader() {
  return loadCookies().header;
}

function isConfigured() {
  return Boolean(loadCookies().header);
}

function isLoggedIn() {
  return Boolean(loadCookies().loggedIn);
}

function getStatus() {
  const state = loadCookies();
  return {
    configured: Boolean(state.header),
    loggedIn: state.loggedIn,
    cookieCount: state.count,
    source: state.source,
    priority: 'COOKIES_CONTENT env, then www.youtube.com_cookies.txt file',
    file:
      state.source === 'env'
        ? 'COOKIES_CONTENT'
        : state.source === 'file'
          ? 'www.youtube.com_cookies.txt'
          : null,
    path: state.source === 'file' ? COOKIES_FILE_PATH : null,
  };
}

function getCookiesRevision() {
  return loadCookies().mtimeMs;
}

function invalidateCache() {
  cache.mtimeMs = 0;
  cache.source = null;
}

module.exports = {
  COOKIES_FILE_PATH,
  resolveCookiesFilePath,
  netscapeToCookieHeader,
  getCookieHeader,
  isConfigured,
  isLoggedIn,
  getStatus,
  getCookiesRevision,
  invalidateCache,
};
