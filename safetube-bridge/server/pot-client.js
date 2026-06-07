// server/pot-client.js — see server/pot-client.cjs in the main bridge (kept in sync).

'use strict';

const http = require('http');
const https = require('https');

const POT_BASE_URL = (
  process.env.YT_DLP_BGUTIL_POT_BASE_URL ||
  process.env.POT_URL ||
  process.env.POT_PROVIDER_URL ||
  'http://127.0.0.1:4416'
)
  .trim()
  .replace(/\/$/, '');

const TOKEN_TTL_MS = Number(process.env.POT_TOKEN_TTL_MS || 45 * 60 * 1000);
const REQUEST_TIMEOUT_MS = 15_000;

/** @type {Map<string, { poToken: string, visitorData: string, fetchedAt: number }>} */
const videoCache = new Map();

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
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        });
      }
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
  try {
    const r = await httpJson('POST', `${POT_BASE_URL}/generate_visitor_data`, {});
    if (r && r.visitor_data) return r.visitor_data;
  } catch { /* fall through */ }

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
            return reject(new Error(`InnerTube /visitor_id HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
          let data;
          try { data = JSON.parse(body); }
          catch { return reject(new Error(`InnerTube /visitor_id non-JSON: ${body.slice(0, 200)}`)); }
          const vd = data?.responseContext?.visitorData;
          if (typeof vd === 'string' && vd.length >= 20) return resolve(vd);
          reject(new Error('InnerTube /visitor_id response missing visitorData'));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('InnerTube /visitor_id timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function mintPoToken(contentBinding, { bypassCache = false } = {}) {
  const r = await httpJson('POST', `${POT_BASE_URL}/get_pot`, {
    content_binding: contentBinding,
    bypass_cache: bypassCache,
  });
  const token = r && (r.po_token || r.poToken);
  if (!token) throw new Error(`POT response missing po_token/poToken: ${JSON.stringify(r)}`);
  return token;
}

async function invalidateCaches() {
  videoCache.clear();
  try { await httpJson('POST', `${POT_BASE_URL}/invalidate_caches`, {}); } catch { /* optional */ }
}

async function getCredentials({ videoId, force = false } = {}) {
  if (!videoId) {
    throw new Error('getCredentials requires videoId');
  }

  const cachedEntry = videoCache.get(videoId);
  const age = cachedEntry ? Date.now() - cachedEntry.fetchedAt : Infinity;
  if (!force && cachedEntry && age < TOKEN_TTL_MS) {
    return { poToken: cachedEntry.poToken, visitorData: cachedEntry.visitorData };
  }

  if (force) await invalidateCaches();

  const visitorData = await fetchVisitorData();
  const poToken = await mintPoToken(videoId, { bypassCache: force });
  videoCache.set(videoId, { poToken, visitorData, fetchedAt: Date.now() });
  console.log(`[pot] video=${videoId} refreshed (pot=${poToken.slice(0, 12)}…)`);
  return { poToken, visitorData };
}

function clearCache() {
  videoCache.clear();
}

module.exports = { ping, getCredentials, invalidateCaches, clearCache, POT_BASE_URL };
