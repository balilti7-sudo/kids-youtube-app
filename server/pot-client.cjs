'use strict';

const http = require('http');
const https = require('https');

/** Render: POT_URL. Windows NSSM: POT_PROVIDER_URL. */
const POT_BASE_URL = (
  process.env.POT_URL ||
  process.env.POT_PROVIDER_URL ||
  'http://127.0.0.1:4416'
).replace(/\/$/, '');
const TOKEN_TTL_MS = Number(process.env.POT_TOKEN_TTL_MS || 5 * 60 * 60 * 1000); 
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
          'User-Agent': 'SafeTubeBridge/1.1',
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

async function fetchVisitorData() {
  console.log('[pot] Fetching fresh visitorData from YouTube...');
  return new Promise((resolve) => {
    https.get('https://www.youtube.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const match = body.match(/"visitorData"\s*:\s*"([^"]+)"/);
        if (match && match[1]) {
          console.log('[pot] Successfully found visitorData');
          resolve(match[1]);
        } else {
          const fallback = "CgtvRE9LSk02S2ZpbyIp"; 
          console.log('[pot] Scraper failed, using fallback visitorData');
          resolve(fallback);
        }
      });
    }).on('error', () => resolve("CgtvRE9LSk02S2ZpbyIp"));
  });
}

async function mintPoToken(visitorData) {
  const r = await httpJson('POST', `${POT_BASE_URL}/get_pot`, {
    content_binding: visitorData,
  });
  
  // תיקון קריטי: מקבל גם po_token וגם poToken
  const token = r.po_token || r.poToken;
  
  if (!r || !token) {
    throw new Error(`POT response missing token: ${JSON.stringify(r)}`);
  }
  return token;
}

async function getCredentials({ force = false } = {}) {
  const age = Date.now() - cached.fetchedAt;
  if (!force && cached.poToken && age < TOKEN_TTL_MS) {
    return { poToken: cached.poToken, visitorData: cached.visitorData };
  }

  if (force) {
    try { await httpJson('POST', `${POT_BASE_URL}/invalidate_caches`, {}); } catch (_) {}
  }

  try {
    const visitorData = (cached.visitorData && !force) ? cached.visitorData : await fetchVisitorData();
    const poToken = await mintPoToken(visitorData);

    cached = { visitorData, poToken, fetchedAt: Date.now() };
    console.log(`[pot] refreshed credentials! (pot=${poToken.slice(0, 10)}...)`);
    return { poToken, visitorData };
  } catch (err) {
    console.error('[pot] Failed to get credentials:', err.message);
    throw err;
  }
}

function ping() { return true; }
function clearCache() { cached = { visitorData: null, poToken: null, fetchedAt: 0 }; }

module.exports = { ping, getCredentials, clearCache, POT_BASE_URL };