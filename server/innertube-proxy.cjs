'use strict';

/** Hostnames the bridge may forward on behalf of the browser (InnerTube / player scripts). */
const ALLOWED_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtubei.googleapis.com',
  'www.youtube-nocookie.com',
]);

const BLOCKED_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
]);

function isAllowedInnertubeProxyUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return true;
    return host.endsWith('.googlevideo.com') || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function sanitizeForwardHeaders(rawHeaders = {}, defaultUserAgent) {
  const out = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (!value || BLOCKED_HEADERS.has(String(key).toLowerCase())) continue;
    out[key] = String(value);
  }
  if (!out['User-Agent'] && !out['user-agent'] && defaultUserAgent) {
    out['User-Agent'] = defaultUserAgent;
  }
  return out;
}

/**
 * Forward a single HTTP request to YouTube on behalf of the browser (CORS bypass).
 * @param {{ url: string, method?: string, headers?: Record<string,string>, body?: string|null }} req
 * @param {{ userAgent?: string, timeoutMs?: number }} opts
 */
async function forwardInnertubeRequest(req, { userAgent = '', timeoutMs = 45_000 } = {}) {
  const url = String(req?.url || '').trim();
  if (!isAllowedInnertubeProxyUrl(url)) {
    const err = new Error('URL not allowed for InnerTube proxy');
    err.code = 'INVALID_PROXY_URL';
    throw err;
  }

  const method = String(req?.method || 'GET').toUpperCase();
  const headers = sanitizeForwardHeaders(req?.headers, userAgent);
  const hasBody = method !== 'GET' && method !== 'HEAD' && req?.body != null && req.body !== '';

  const response = await fetch(url, {
    method,
    headers,
    body: hasBody ? String(req.body) : undefined,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.text();
  const responseHeaders = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: responseHeaders,
    body,
  };
}

module.exports = {
  forwardInnertubeRequest,
  isAllowedInnertubeProxyUrl,
};
