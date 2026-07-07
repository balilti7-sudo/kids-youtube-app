'use strict';

const fs = require('fs');
const path = require('path');

/** Single fixed cookies file — no env overrides. */
const COOKIES_FILE_PATH = path.join(__dirname, 'www.youtube.com_cookies.txt');

/** @type {{ path: string|null, mtimeMs: number, header: string, count: number, loggedIn: boolean }} */
let cache = {
  path: null,
  mtimeMs: 0,
  header: '',
  count: 0,
  loggedIn: false,
};

function resolveCookiesFilePath() {
  if (fs.existsSync(COOKIES_FILE_PATH)) return COOKIES_FILE_PATH;
  console.warn(`[innertube/cookies] file not found: ${COOKIES_FILE_PATH}`);
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

function loadCookies() {
  const filePath = resolveCookiesFilePath();
  if (!filePath) {
    cache = { path: COOKIES_FILE_PATH, mtimeMs: 0, header: '', count: 0, loggedIn: false };
    return cache;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    console.warn(`[innertube/cookies] stat failed for ${filePath}: ${err?.message || err}`);
    cache = { path: filePath, mtimeMs: 0, header: '', count: 0, loggedIn: false };
    return cache;
  }

  if (cache.path === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }

  try {
    const parsed = netscapeToCookieHeader(fs.readFileSync(filePath, 'utf8'));
    cache = {
      path: filePath,
      mtimeMs: stat.mtimeMs,
      header: parsed.header,
      count: parsed.count,
      loggedIn: parsed.loggedIn,
    };
    console.log(
      `[innertube/cookies] loaded ${parsed.count} cookie(s) from ${path.basename(filePath)}` +
        (parsed.loggedIn ? ' (logged-in session)' : ' (anonymous/visitor)')
    );
  } catch (err) {
    console.warn(`[innertube/cookies] read failed for ${filePath}: ${err?.message || err}`);
    cache = { path: filePath, mtimeMs: stat.mtimeMs, header: '', count: 0, loggedIn: false };
  }

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
    file: 'www.youtube.com_cookies.txt',
    path: COOKIES_FILE_PATH,
  };
}

function getCookiesRevision() {
  return loadCookies().mtimeMs;
}

function invalidateCache() {
  cache.mtimeMs = 0;
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
