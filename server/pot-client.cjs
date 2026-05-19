// server/pot-client.js
// Client for bgutil-ytdlp-pot-provider HTTP server (Rust or Node build).
// Handles:
//   - visitor_data acquisition + caching
//   - PO token minting bound to visitor_data
//   - automatic refresh on expiry/failure
//
// HTTP API reference (bgutil-pot >= 0.8):
//   POST /get_pot                { content_binding: "<visitor_data>" } -> { po_token, content_binding }
//   POST /invalidate_caches      {}
//   GET  /ping                   -> 200 OK when alive
//
// Older builds expose /generate_visitor_data; if not present we fall back to a
// lightweight bootstrap call against youtube.com (no auth required) to mint one.

'use strict';

const http = require('http');
const https = require('https');

/** Render: POT_URL. Windows NSSM: POT_PROVIDER_URL. */
const POT_BASE_URL = (
  process.env.POT_URL ||
  process.env.POT_PROVIDER_URL ||
  'http://127.0.0.1:4416'
).replace(/\/$/, '');
const TOKEN_TTL_MS = Number(process.env.POT_TOKEN_TTL_MS || 5 * 60 * 60 * 1000); // 5h, below YT's ~6h
const REQUEST_TIMEOUT_MS = 15_000;

let cached = {
  visitorData: null,
  poToken: null,
  fetchedAt: 0,
};

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload ? payload.length : 0,
          'User-Agent': 'SafeTubeBridge/1.0',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`POT ${method} ${u.pathname} -> ${res.statusCode}: ${text}`));
          }
          if (!text) return resolve(null);
          try { resolve(JSON.parse(text)); } catch (e) { resolve(text); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('POT request timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function ping() {
  try {
    await httpJson('GET', `${POT_BASE_URL}/ping`);
    return true;
  } catch (err) {
    console.error('[pot] ping failed:', err.message);
    return false;
  }
}

async function fetchVisitorData() {
  // First try the provider's own endpoint (newer builds).
  try {
    const r = await httpJson('POST', `${POT_BASE_URL}/generate_visitor_data`, {});
    if (r && r.visitor_data) return r.visitor_data;
  } catch (_) { /* fall through */ }

  // Fallback: InnerTube /visitor_id endpoint (public, no auth).
  // YouTube removed `visitorData` from www.youtube.com/sw.js_data in 2026, so
  // we mint a fresh visitor identity directly via the WEB client InnerTube call
  // (same strategy as deploy/windows-server/generate-po-token.mjs).
  return await new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240814.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
    }));

    const req = https.request(
      {
        method: 'POST',
        hostname: 'www.youtube.com',
        port: 443,
        path: '/youtubei/v1/visitor_id?prettyPrint=false',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'X-YouTube-Client-Name': '1',
          'X-YouTube-Client-Version': '2.20240814.00.00',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(
              `InnerTube /visitor_id HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
            ));
          }
          let data;
          try { data = JSON.parse(body); }
          catch (e) { return reject(new Error(`InnerTube /visitor_id non-JSON response: ${body.slice(0, 200)}`)); }
          const vd = data && data.responseContext && data.responseContext.visitorData;
          if (typeof vd === 'string' && vd.length >= 20) return resolve(vd);
          reject(new Error('InnerTube /visitor_id response missing visitorData'));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('InnerTube /visitor_id timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function mintPoToken(visitorData) {
  const r = await httpJson('POST', `${POT_BASE_URL}/get_pot`, {
    content_binding: visitorData,
  });
  if (!r || !r.po_token) {
    throw new Error(`POT response missing po_token: ${JSON.stringify(r)}`);
  }
  return r.po_token;
}

/**
 * Get a fresh { poToken, visitorData } pair, cached for TOKEN_TTL_MS.
 * Call `force: true` to bypass cache (e.g. after a 'Sign in to confirm' error).
 */
async function getCredentials({ force = false } = {}) {
  const age = Date.now() - cached.fetchedAt;
  if (!force && cached.poToken && age < TOKEN_TTL_MS) {
    return { poToken: cached.poToken, visitorData: cached.visitorData };
  }

  if (force) {
    try { await httpJson('POST', `${POT_BASE_URL}/invalidate_caches`, {}); } catch (_) {}
  }

  const visitorData = cached.visitorData && !force ? cached.visitorData : await fetchVisitorData();
  const poToken = await mintPoToken(visitorData);

  cached = { visitorData, poToken, fetchedAt: Date.now() };
  console.log(
    `[pot] refreshed credentials (visitor=${visitorData.slice(0, 12)}…, ` +
    `pot=${poToken.slice(0, 12)}…)`,
  );
  return { poToken, visitorData };
}

function clearCache() {
  cached = { visitorData: null, poToken: null, fetchedAt: 0 };
}

module.exports = { ping, getCredentials, clearCache, POT_BASE_URL };
