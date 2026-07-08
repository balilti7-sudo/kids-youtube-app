'use strict';

/**
 * Shared residential/rotating proxy support for the bridge's own outbound requests
 * (InnerTube API calls + BotGuard/PO Token attestation) — NOT the bulk googlevideo
 * media byte-stream, which stays direct from Render (bandwidth cost + no evidence
 * GVS edge nodes apply the same IP-reputation gate as the InnerTube API layer).
 *
 * Reuses the exact same Webshare/rotating-proxy scaffolding already proven out for
 * yt-dlp (see ingest-ytdlp.cjs): same URL normalization, same backconnect-host fix,
 * same Render-dashboard "@ corruption" repair. New `MEDIA_PROXY_*` env vars are
 * preferred (this proxy is no longer yt-dlp-specific), but every one of them falls
 * back to the existing `YT_DLP_PROXY*` vars so already-configured Webshare
 * credentials work here with zero re-entry.
 */

/** Webshare backbone / backconnect rotation endpoint (not ap.webshare.io). */
const WEBSHARE_BACKCONNECT_HOST = 'p.webshare.io';

function envFirst(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeWebshareProxyHost(host) {
  const value = String(host || '').trim();
  if (!value || !/ap\.webshare\.io/i.test(value)) return value;
  console.warn(`[media-proxy] proxy host ap.webshare.io → ${WEBSHARE_BACKCONNECT_HOST} (backconnect rotation)`);
  return value.replace(/ap\.webshare\.io/gi, WEBSHARE_BACKCONNECT_HOST);
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
    console.warn(`[media-proxy] proxy URL host ap.webshare.io → ${WEBSHARE_BACKCONNECT_HOST}`);
  }

  // Render env UIs sometimes corrupt "@" to the literal letter "a" immediately before an IPv4 host.
  const atCorruptionFixed = value.replace(
    /^(https?:\/\/)([^:]+):([^@/]+?)a(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i,
    (_, scheme, user, pass, ip, portSuffix = '') => {
      console.warn('[media-proxy] repaired proxy URL: corrected corrupted @ (literal "a") before host IP');
      return `${scheme}${user}:${pass}@${ip}${portSuffix}`;
    }
  );
  if (atCorruptionFixed !== value) value = atCorruptionFixed;

  if (!value.includes('@')) {
    const missingAtFixed = value.replace(
      /^(https?:\/\/)([^:]+):([^/]+?)(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i,
      (_, scheme, user, pass, ip, portSuffix = '') => {
        console.warn('[media-proxy] repaired proxy URL: inserted missing @ before host IP');
        return `${scheme}${user}:${pass}@${ip}${portSuffix}`;
      }
    );
    if (missingAtFixed !== value) value = missingAtFixed;
  }

  return value;
}

function proxyHostHasExplicitPort(proxyUrl) {
  const afterAuth = proxyUrl.replace(/^https?:\/\/(?:[^@/]+@)?/i, '');
  const hostPart = afterAuth.split('/')[0].split('?')[0].split('#')[0];
  if (hostPart.startsWith('[')) return /^\[[^\]]+\]:\d+$/.test(hostPart);
  return /:\d+$/.test(hostPart);
}

/** The URL API omits default ports (:80 / :443), which breaks Webshare backconnect on Render. */
function applyProxyPortFallback(proxyUrl, portOverride = '') {
  if (!proxyUrl) return '';
  const port = String(portOverride || '').trim();
  if (!port || proxyHostHasExplicitPort(proxyUrl)) return proxyUrl;
  return proxyUrl.replace(
    /^(https?:\/\/(?:[^@/]+@)?)([^/?#]+)(.*)$/i,
    (_, prefix, hostname, suffix) => `${prefix}${hostname}:${port}${suffix}`
  );
}

function parseProxyHostPort(hostRaw, portRaw) {
  const portFromEnv = String(portRaw || '').trim();
  const host = String(hostRaw || '').trim();
  if (!host || host.startsWith('[')) return { host, port: portFromEnv };

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

function buildProxyUrlFromParts({ scheme, user, pass, host, port }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  return applyProxyPortFallback(`${scheme}://${auth}${host}`, port);
}

function proxyHostFromUrl(proxyUrl) {
  const afterAuth = proxyUrl.replace(/^https?:\/\/(?:[^@/]+@)?/i, '');
  return afterAuth.split('/')[0].split('?')[0].split('#')[0];
}

function proxyForLog(proxyUrl) {
  if (!proxyUrl) return '(none)';
  const schemeMatch = proxyUrl.match(/^(https?:\/\/)/i);
  if (!schemeMatch) return '(invalid proxy URL)';
  const hasAuth = /^https?:\/\/[^@/]+@/i.test(proxyUrl);
  return `${schemeMatch[1]}${hasAuth ? '***:***@' : ''}${proxyHostFromUrl(proxyUrl)}`;
}

function proxySource() {
  if (envFirst('MEDIA_PROXY_URL')) return 'MEDIA_PROXY_URL';
  if (envFirst('YT_DLP_PROXY')) return 'YT_DLP_PROXY (shared with yt-dlp)';
  if (envFirst('MEDIA_PROXY_HOST')) return 'MEDIA_PROXY_* components';
  if (envFirst('YT_DLP_PROXY_HOST')) return 'YT_DLP_PROXY_* components (shared with yt-dlp)';
  return 'none';
}

let lastLoggedEndpoint = null;
function logResolvedProxyOnce(proxyUrl, source) {
  const endpoint = proxyUrl ? proxyForLog(proxyUrl) : '(none)';
  if (endpoint === lastLoggedEndpoint) return;
  lastLoggedEndpoint = endpoint;
  if (proxyUrl) {
    console.log(`[media-proxy] InnerTube/PO-Token egress via proxy: ${endpoint} source=${source}`);
  } else {
    console.log('[media-proxy] no proxy configured — InnerTube/PO-Token requests go direct from this box');
  }
}

/**
 * Resolve the proxy URL for the bridge's own InnerTube/BotGuard requests.
 * Priority: MEDIA_PROXY_URL → YT_DLP_PROXY → MEDIA_PROXY_HOST/* → YT_DLP_PROXY_HOST/*.
 */
function getProxyUrl() {
  const directUrl = envFirst('MEDIA_PROXY_URL', 'YT_DLP_PROXY');
  const portEnv = envFirst('MEDIA_PROXY_PORT', 'YT_DLP_PROXY_PORT');

  if (directUrl) {
    const resolved = applyProxyPortFallback(normalizeProxyUrl(directUrl), portEnv);
    logResolvedProxyOnce(resolved, proxySource());
    return resolved;
  }

  const hostRaw = normalizeWebshareProxyHost(envFirst('MEDIA_PROXY_HOST', 'YT_DLP_PROXY_HOST'));
  if (!hostRaw) {
    logResolvedProxyOnce('', 'none');
    return '';
  }

  const scheme = envFirst('MEDIA_PROXY_SCHEME', 'YT_DLP_PROXY_SCHEME') || 'http';
  const user = envFirst('MEDIA_PROXY_USER', 'YT_DLP_PROXY_USER');
  const pass = envFirst('MEDIA_PROXY_PASSWORD', 'YT_DLP_PROXY_PASSWORD', 'YT_DLP_PROXY_PASS');
  const { host, port } = parseProxyHostPort(hostRaw, portEnv);

  const resolved = buildProxyUrlFromParts({ scheme: scheme.replace(/:$/, ''), user, pass, host, port });
  logResolvedProxyOnce(resolved, proxySource());
  return resolved;
}

function isConfigured() {
  return Boolean(getProxyUrl());
}

let undiciModule = null;
function getUndici() {
  if (!undiciModule) undiciModule = require('undici');
  return undiciModule;
}

let dispatcherCache = { url: null, dispatcher: null };

/** Build (and cache) an undici ProxyAgent dispatcher for `fetch(url, { dispatcher })`. */
function getProxyDispatcher() {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return null;
  if (dispatcherCache.url === proxyUrl && dispatcherCache.dispatcher) {
    return dispatcherCache.dispatcher;
  }

  const { ProxyAgent } = getUndici();
  const m = proxyUrl.match(/^(https?:\/\/)(?:([^@/]+)@)?(.+)$/i);
  let dispatcher;
  if (!m) {
    dispatcher = new ProxyAgent(proxyUrl);
  } else {
    const [, scheme, userinfo, hostPart] = m;
    const base = `${scheme}${hostPart}`;
    if (userinfo) {
      let decoded = userinfo;
      try {
        decoded = decodeURIComponent(userinfo);
      } catch {
        /* keep raw */
      }
      dispatcher = new ProxyAgent({ uri: base, token: 'Basic ' + Buffer.from(decoded).toString('base64') });
    } else {
      dispatcher = new ProxyAgent(base);
    }
  }

  dispatcherCache = { url: proxyUrl, dispatcher };
  return dispatcher;
}

function describeProxyMode() {
  const proxyUrl = getProxyUrl();
  const source = proxySource();
  if (!proxyUrl) {
    return { configured: false, mode: 'none', endpoint: '(none)', source };
  }
  return {
    configured: true,
    mode: 'http-proxy',
    endpoint: proxyForLog(proxyUrl),
    source,
  };
}

module.exports = {
  getProxyUrl,
  getProxyDispatcher,
  describeProxyMode,
  isConfigured,
};
