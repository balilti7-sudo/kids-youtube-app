/**
 * Media Bridge — YouTube videoId → playable stream (yt-dlp primary, Piped/Invidious fallbacks,
 * optional @distube/ytdl-core when YTDL_RESOLVE_ENABLE=1).
 * Streams are **proxied** through this server so the browser never requests geo/bot-protected CDNs directly.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import { ProxyAgent } from 'undici'
/** Maintained fork of ytdl-core (signature fixes). Pin to latest in server/package.json. */
import ytdl from '@distube/ytdl-core'
import { createClient } from '@supabase/supabase-js'
import { registerWelcomeEmailRoute } from './email/welcomeRoute.js'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
// If the parent process already set PORT / HOST (Render, systemd, `PORT=3001 node index.js`),
// keep them — do not let `.env` override deployment or shell intent.
const inheritedPortFromShell = process.env.PORT
const inheritedMediaBridgeHostFromShell = process.env.MEDIA_BRIDGE_HOST
const inheritedHostFromShell = process.env.HOST

// Repo root `.env`, then `server/.env` (latter wins) so a single file at the project root can serve Vite + API.
const ROOT_ENV = path.join(SERVER_DIR, '..', '.env')
const SERVER_ENV = path.join(SERVER_DIR, '.env')
if (existsSync(ROOT_ENV)) {
  dotenv.config({ path: ROOT_ENV })
}
if (existsSync(SERVER_ENV)) {
  dotenv.config({ path: SERVER_ENV, override: true })
}
if (!existsSync(ROOT_ENV) && !existsSync(SERVER_ENV)) {
  dotenv.config()
}

if (inheritedPortFromShell !== undefined && String(inheritedPortFromShell).trim() !== '') {
  process.env.PORT = inheritedPortFromShell
}
if (inheritedMediaBridgeHostFromShell !== undefined && String(inheritedMediaBridgeHostFromShell).trim() !== '') {
  process.env.MEDIA_BRIDGE_HOST = inheritedMediaBridgeHostFromShell
}
if (inheritedHostFromShell !== undefined && String(inheritedHostFromShell).trim() !== '') {
  process.env.HOST = inheritedHostFromShell
}

// YouTube: browser cookie headers and cookie files are not supported — use YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA only.
for (const k of ['YOUTUBE_COOKIES', 'YTDL_COOKIES', 'YOUTUBE_COOKIES_FILE']) {
  if (process.env[k] != null && String(process.env[k]).trim() !== '') {
    process.env[k] = ''
  }
}

const LOCAL_DEFAULT_YT_DLP =
  process.platform === 'win32' ? path.join(SERVER_DIR, 'yt-dlp.exe') : path.join(SERVER_DIR, 'yt-dlp')
// On hosted Linux (Render/Railway), local binary may not exist on first deploy.
// Fallback to PATH-installed yt-dlp so the bridge can still resolve streams.
const DEFAULT_YT_DLP = existsSync(LOCAL_DEFAULT_YT_DLP) ? LOCAL_DEFAULT_YT_DLP : 'yt-dlp'

const RAW_PORT = Number.parseInt(String(process.env.PORT || ''), 10)
/** Default 3001 for local / home servers; Render and others set `PORT` in the environment. */
const PORT = Number.isFinite(RAW_PORT) && RAW_PORT > 0 ? RAW_PORT : 3001

/** Bind address: `0.0.0.0` listens on all interfaces (reachable via LAN / public IP). */
const HOST = (process.env.MEDIA_BRIDGE_HOST || process.env.HOST || '0.0.0.0').trim() || '0.0.0.0'

function isTruthyEnvFlag(v) {
  return /^(1|true|yes|on)$/i.test(String(v ?? '').trim())
}

/**
 * CORS allow-any (reflects browser Origin). Dev convenience; avoid in production on a public IP.
 * `CORS_ORIGIN=*` in `.env` also enables this for backward compatibility with older configs.
 */
const MEDIA_BRIDGE_CORS_ALLOW_ANY =
  isTruthyEnvFlag(process.env.MEDIA_BRIDGE_CORS_ALLOW_ANY) || String(process.env.CORS_ORIGIN || '').trim() === '*'

function buildDefaultCorsOrigins(port) {
  return [
    'https://www.safetube.co.il',
    'https://safetube.co.il',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]
}

function parseMediaBridgeCorsAllowlist(port) {
  const raw = (process.env.MEDIA_BRIDGE_CORS_ORIGINS || '').trim()
  if (raw) {
    return raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)
  }
  return buildDefaultCorsOrigins(port)
}

const MEDIA_BRIDGE_CORS_ORIGIN_LIST = parseMediaBridgeCorsAllowlist(PORT)
const ALLOWED_CORS_ORIGIN_SET = new Set(MEDIA_BRIDGE_CORS_ORIGIN_LIST)

function corsDynamicOrigin(origin, cb) {
  if (MEDIA_BRIDGE_CORS_ALLOW_ANY) {
    cb(null, true)
    return
  }
  if (!origin) {
    cb(null, true)
    return
  }
  if (ALLOWED_CORS_ORIGIN_SET.has(origin)) {
    cb(null, true)
    return
  }
  console.warn(`[cors] rejected Origin not in allowlist: ${origin}`)
  cb(null, false)
}

/**
 * CORS: allowlisted production origins (Vercel) + local dev; or allow-any when
 * `MEDIA_BRIDGE_CORS_ALLOW_ANY=1` / `CORS_ORIGIN=*`.
 * POST/PUT/PATCH/DELETE kept for `/api/stream`, email routes, etc.
 */
const corsOptions = {
  origin: corsDynamicOrigin,
  credentials: false,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Range',
    'Content-Type',
    'Authorization',
    'Accept',
    'X-Requested-With',
    'X-Media-Bridge-Welcome-Key',
  ],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
  maxAge: 600,
  optionsSuccessStatus: 204,
}

const corsMiddleware = cors(corsOptions)

/**
 * Proxied `/api/media` and `/api/segment` pipe CDN headers through — upstream may send its own
 * `Access-Control-Allow-Origin`, which breaks cross-origin playback from https://www.safetube.co.il.
 * Set bridge policy explicitly before forwarding (and strip upstream ACAO in `forwardSafeHeadersToRes`).
 */
function applyMediaCorsHeaders(req, res) {
  const origin = (req.get('origin') || '').trim()
  if (MEDIA_BRIDGE_CORS_ALLOW_ANY) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  } else if (origin && ALLOWED_CORS_ORIGIN_SET.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    return
  }
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type')
  const vary = res.getHeader('Vary')
  const v = vary == null ? '' : Array.isArray(vary) ? vary.join(', ') : String(vary)
  if (!v || !/\bOrigin\b/i.test(v)) {
    res.setHeader('Vary', v ? `${v}, Origin` : 'Origin')
  }
}

/**
 * How long to remember a successfully-resolved upstream URL for a given
 * videoId. Shorter is safer (CDN URLs can expire / become geo-restricted) but
 * costs more resolves. 15 minutes is a sweet spot: long enough to absorb the
 * typical replay/seek cycle without re-hitting Piped/ytdl, short enough that
 * a stale upstream URL self-heals quickly.
 */
const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS) || 15 * 60 * 1000
const SEGMENT_TOKEN_TTL_MS = Number(process.env.SEGMENT_TOKEN_TTL_MS) || 60 * 60 * 1000
const YT_DLP_PATH = (process.env.YT_DLP_PATH || DEFAULT_YT_DLP).trim()
const YT_DLP_ENABLE = (process.env.YT_DLP_ENABLE || '1').toLowerCase() === '1' || process.env.YT_DLP_ENABLE === 'true'
/**
 * `@distube/ytdl-core` is off by default: it can return ciphered streams the browser
 * cannot decode without full n/sig handling in-app. Set `YTDL_RESOLVE_ENABLE=1` to
 * append it as a last-resort resolver after yt-dlp + public proxies.
 */
const YTDL_RESOLVE_ENABLE =
  (process.env.YTDL_RESOLVE_ENABLE || '').toLowerCase() === '1' || process.env.YTDL_RESOLVE_ENABLE === 'true'
const YT_DLP_CACHE_DIR = '/tmp/yt-dlp-cache'
const YT_OAUTH_TOKEN_PATH = (process.env.YT_OAUTH_TOKEN_PATH || '/etc/secrets/yt_oauth_token.json').trim()
const YT_UPSTREAM_TIMEOUT_MS = 60_000
/**
 * Hard ceiling for the *total* time `resolveUpstream` is allowed to spend across
 * all backends. Stays below the frontend's `STREAM_INFO_TIMEOUT_MS` (120s) so the
 * client receives JSON errors instead of a generic fetch abort.
 */
const OVERALL_RESOLVE_BUDGET_MS = Number(process.env.OVERALL_RESOLVE_BUDGET_MS) || 120_000
/** Per-Piped-instance fetch timeout. Public instances are unstable — fail fast. */
const PIPED_PER_INSTANCE_TIMEOUT_MS = Number(process.env.PIPED_PER_INSTANCE_TIMEOUT_MS) || 8_000
/** Cap how many Piped instances we try per request so dead instances can't exhaust the budget. */
const PIPED_MAX_INSTANCES_PER_REQUEST = Number(process.env.PIPED_MAX_INSTANCES_PER_REQUEST) || 6
/** Per-strategy timeout for `ytdl.getInfo` — there are 3 strategies. */
const YTDL_GETINFO_TIMEOUT_MS = Number(process.env.YTDL_GETINFO_TIMEOUT_MS) || 20_000
/** Per-attempt timeout for the yt-dlp CLI (spawn kill); also see `--socket-timeout` in baseArgs. */
const YT_DLP_PER_ATTEMPT_TIMEOUT_MS = Number(process.env.YT_DLP_PER_ATTEMPT_TIMEOUT_MS) || 30_000
/**
 * Memory of which Piped/Invidious instances just blocked us — `base -> expirationTimestamp`.
 * Render's outbound IPs are widely blacklisted by public proxies; without this cache we'd
 * waste every request retrying the same dead instances.
 */
const DEAD_INSTANCE_TTL_MS = Number(process.env.DEAD_INSTANCE_TTL_MS) || 5 * 60 * 1000
/** @type {Map<string, number>} */
const deadInstances = new Map()
function markInstanceDead(base, reason) {
  deadInstances.set(base, Date.now() + DEAD_INSTANCE_TTL_MS)
  console.warn(`[deadcache] ${base} marked dead for ${Math.round(DEAD_INSTANCE_TTL_MS / 1000)}s (${reason})`)
}
function isInstanceDead(base) {
  const exp = deadInstances.get(base)
  if (!exp) return false
  if (Date.now() > exp) {
    deadInstances.delete(base)
    return false
  }
  return true
}

/**
 * YouTube auth cooldown — set when ytdl returns 429 or yt-dlp hits a sign-in/bot gate.
 * While active, Invidious/Piped are tried first. Any successful resolution clears it.
 */
const YT_AUTH_STALE_TTL_MS = Number(process.env.YT_AUTH_STALE_TTL_MS) || 5 * 60 * 1000
let ytAuthStaleUntil = 0
function isYtAuthStale() {
  if (!ytAuthStaleUntil) return false
  if (Date.now() > ytAuthStaleUntil) {
    ytAuthStaleUntil = 0
    return false
  }
  return true
}
function markYtAuthStaleNow(reason = 'unspecified') {
  ytAuthStaleUntil = Date.now() + YT_AUTH_STALE_TTL_MS
  console.warn(
    `[ytauth] YouTube auth marked STALE for ${Math.round(YT_AUTH_STALE_TTL_MS / 1000)}s (reason=${reason}) — preferring invidious/piped during cooldown`
  )
}
function clearYtAuthStale() {
  if (ytAuthStaleUntil) {
    console.log('[ytauth] auth recovered — clearing stale cooldown')
  }
  ytAuthStaleUntil = 0
}
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
/** Service role — Media Bridge only; never expose to the browser. Used for pairing-code reminder emails. */
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const REQUIRE_CONFIRMED_EMAIL_FOR_STREAM =
  (process.env.REQUIRE_CONFIRMED_EMAIL_FOR_STREAM || '1').toLowerCase() !== '0'
const STREAM_GRANT_TTL_MS = Number(process.env.STREAM_GRANT_TTL_MS) || 15 * 60 * 1000
const STREAM_GRANT_SECRET =
  (process.env.MEDIA_BRIDGE_GRANT_SECRET || process.env.STREAM_GRANT_SECRET || process.env.SUPABASE_JWT_SECRET || '').trim() ||
  'dev-media-bridge-grant-secret-change-me'

function bundledFfmpegPath() {
  const p =
    process.platform === 'win32' ? path.join(SERVER_DIR, 'ffmpeg.exe') : path.join(SERVER_DIR, 'ffmpeg')
  return existsSync(p) ? p : null
}

/**
 * If set, used for URLs embedded in m3u8 (when Host header is wrong behind TLS termination).
 * Otherwise derived from each request.
 */
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')

const MODERN_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const BROWSER_UA = (process.env.BROWSER_USER_AGENT || '').trim() || MODERN_CHROME_UA

/** Default reference UA for yt-dlp when `YT_DLP_USER_AGENT` is unset (Chrome on Windows). */
const CHROME_REF_UA = MODERN_CHROME_UA
const YT_DLP_UA = (process.env.YT_DLP_USER_AGENT || '').trim() || CHROME_REF_UA

/**
 * Optional YouTube PO token for yt-dlp (`CLIENT.CONTEXT+TOKEN`, see yt-dlp wiki PO-Token-Guide).
 * Merged into `--extractor-args` when set. Pair with `YOUTUBE_VISITOR_DATA` from the same session.
 *
 * Examples:
 *   web.gvs+TOKEN1                                  (single-client form)
 *   web.gvs+TOKEN1,web.player+TOKEN2,mweb.gvs+TOK3  (multi-client comma-joined)
 */
const YOUTUBE_PO_TOKEN = (process.env.YOUTUBE_PO_TOKEN || '').trim()

/**
 * Optional YouTube `visitor_data` (a.k.a. visitorData / __Secure-YEC). Must come from the SAME
 * browser session that minted the PO token, otherwise YouTube rejects the pair as inconsistent.
 * Merged into yt-dlp `--extractor-args` alongside `po_token` when set.
 */
const YOUTUBE_VISITOR_DATA = (process.env.YOUTUBE_VISITOR_DATA || '').trim()

function hasYoutubePoPair() {
  return Boolean(YOUTUBE_PO_TOKEN && YOUTUBE_VISITOR_DATA)
}

/** Merge a `key=value` pair into a yt-dlp `youtube:...` extractor-args inner string (idempotent). */
function mergeYoutubeExtractorParam(inner, key, value) {
  if (!value) return inner
  const re = new RegExp(`(?:^|;)\\s*${key}=`)
  if (re.test(inner)) return inner
  return inner.length ? `${inner};${key}=${value}` : `${key}=${value}`
}

/**
 * Augment a `youtube:player_client=...` extractor-args string with `po_token` and `visitor_data`
 * from env (when set). Idempotent — re-running on an already-augmented string is a no-op.
 */
function applyYoutubeAuthExtractorArgs(extractorArgsString) {
  const s = String(extractorArgsString || '').trim()
  if (!s.startsWith('youtube:')) return s
  if (!YOUTUBE_PO_TOKEN && !YOUTUBE_VISITOR_DATA) return s
  let inner = s.slice('youtube:'.length).trim()
  inner = mergeYoutubeExtractorParam(inner, 'po_token', YOUTUBE_PO_TOKEN)
  inner = mergeYoutubeExtractorParam(inner, 'visitor_data', YOUTUBE_VISITOR_DATA)
  return inner.length ? `youtube:${inner}` : 'youtube:'
}

/**
 * Optional outbound HTTPS proxy URL. When set, all YouTube-bound traffic
 * (`@distube/ytdl-core` and the yt-dlp CLI) goes through it instead of
 * Render's flagged egress IP. Accepts the standard `http(s)://[user:pass@]host:port`
 * form. Falls back to common conventions `HTTPS_PROXY`/`HTTP_PROXY` so popular
 * proxy providers' starter configs work out of the box.
 */
/**
 * Trim + strip wrapping quotes (common when pasting into Render env UI) and
 * validate the string is a URL. Returns empty string if unusable.
 */
function normalizeProxyUrlString(raw) {
  if (!raw || typeof raw !== 'string') return ''
  let s = raw.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  if (!s) return ''
  try {
    const u = new URL(s)
    if (!u.protocol || u.protocol === ':') return ''
    return u.toString()
  } catch {
    return ''
  }
}

function envFlagTruthy(v) {
  return /^(1|true|yes|on)$/i.test(String(v ?? '').trim())
}

/** Set OUTBOUND_PROXY_DISABLE=1 (or MEDIA_BRIDGE_DISABLE_OUTBOUND_PROXY=1) to force direct egress (no HTTP proxy) for testing. */
const OUTBOUND_PROXY_DISABLED =
  envFlagTruthy(process.env.OUTBOUND_PROXY_DISABLE) ||
  envFlagTruthy(process.env.MEDIA_BRIDGE_DISABLE_OUTBOUND_PROXY)

const RAW_OUTBOUND_PROXY_FROM_ENV = OUTBOUND_PROXY_DISABLED
  ? ''
  : (process.env.OUTBOUND_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '')
const OUTBOUND_PROXY_URL = normalizeProxyUrlString(RAW_OUTBOUND_PROXY_FROM_ENV)
if (OUTBOUND_PROXY_DISABLED) {
  console.warn(
    '[media-bridge] Outbound proxy DISABLED by env — using raw server egress (OUTBOUND_PROXY_DISABLE / MEDIA_BRIDGE_DISABLE_OUTBOUND_PROXY).'
  )
} else if (RAW_OUTBOUND_PROXY_FROM_ENV.trim() && !OUTBOUND_PROXY_URL) {
  console.warn(
    '[media-bridge] OUTBOUND_PROXY_URL / HTTPS_PROXY is set but is not a valid URL after trimming — proxy disabled'
  )
}

/** `http:` / `https:` — undici `ProxyAgent` + Node `fetch({ dispatcher })` can use these. SOCKS is yt-dlp only. */
function isHttpSchemeProxy(uri) {
  if (!uri) return false
  try {
    return /^https?:$/i.test(new URL(uri).protocol)
  } catch {
    return false
  }
}

/** Singleton undici dispatcher so every server-side fetch can share the outbound tunnel. */
let undiciProxyDispatcher = null
function getUndiciProxyDispatcher() {
  if (!OUTBOUND_PROXY_URL || !isHttpSchemeProxy(OUTBOUND_PROXY_URL)) return null
  if (!undiciProxyDispatcher) {
    undiciProxyDispatcher = new ProxyAgent({ uri: OUTBOUND_PROXY_URL })
  }
  return undiciProxyDispatcher
}

/**
 * All Media Bridge egress that must share the same public IP as yt-dlp / ytdl
 * (especially `googlevideo` / `ytimg` segment fetches) goes through here when
 * an HTTP(S) proxy is configured.
 */
function bridgeFetch(input, init = {}) {
  const d = getUndiciProxyDispatcher()
  if (d && init && init.dispatcher === undefined) {
    return fetch(input, { ...init, dispatcher: d })
  }
  return fetch(input, init)
}

/** Mask `user:pass@` in a proxy URL so it's safe to log/return from /api/diagnostics. */
function maskProxyUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.username || u.password) {
      u.username = u.username ? '***' : ''
      u.password = u.password ? '***' : ''
    }
    return u.toString()
  } catch {
    return '***invalid-proxy-url***'
  }
}

const PIPED_FETCH_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': BROWSER_UA,
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
}

const UPSTREAM_MEDIA_HEADERS = {
  'user-agent': BROWSER_UA,
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
}

/**
 * Tried first (less “burned” public Piped API roots), no trailing slash.
 * Then: env PIPED_API_BASES, then the rest of DEFAULT_PIPED_BASES shuffled.
 */
/**
 * Top picks observed reachable from Render's IP range (verified via
 * /api/diagnostics 2026-05). Order matters — bridge tries these first before
 * the wider DEFAULT pool. Re-rank if these stop working.
 */
const PREFERRED_PIPED_BASES = [
  'https://pipedapi.tokhmi.xyz',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
]

const DEFAULT_PIPED_BASES = [
  'https://pipedapi.tokhmi.xyz',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.lunar.icu',
  'https://api.vkr.dev',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.privacyredirect.com',
  'https://pipedapi.privacydev.net',
  'https://pa.mint.lgbt',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.nerdvpn.de',
  'https://api.piped.coderabbit.de',
]
const INVIDIOUS_PER_INSTANCE_TIMEOUT_MS = Number(process.env.INVIDIOUS_PER_INSTANCE_TIMEOUT_MS) || 8_000
const INVIDIOUS_MAX_INSTANCES_PER_REQUEST = Number(process.env.INVIDIOUS_MAX_INSTANCES_PER_REQUEST) || 6
/**
 * `inv.nadeko.net` returns 403 from Render IPs (verified 2026-05); demoted to
 * the wider default pool so we still try it but never as the very first call.
 */
const PREFERRED_INVIDIOUS_BASES = ['https://invidious.projectsegfau.lt']
const DEFAULT_INVIDIOUS_BASES = [
  'https://invidious.projectsegfau.lt',
  'https://inv.nadeko.net',
  'https://invidious.privacyredirect.com',
  'https://invidious.slipfox.xyz',
  'https://vid.puffyan.us',
  'https://yewtu.be',
  'https://invidious.private.coffee',
  'https://invidious.perennialte.ch',
  'https://invidious.jing.rocks',
  'https://invidious.fdn.fr',
  'https://invidious.protokolla.fi',
]

let cachedYtdlAgent = { key: null, agent: null }

/** @type {Map<string, { exp: number, upstreamUrl: string, hls: boolean, mimeType: string, quality: string | null, source: string }>} */
const streamCache = new Map()
/** Lightweight in-process counters surfaced via /api/diagnostics so we can verify the cache is doing real work. */
const cacheStats = { hits: 0, misses: 0, sets: 0, expired: 0 }

/** @type {Map<string, { url: string, exp: number, grant: string }>} */
const segmentTokens = new Map()

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/
const supabaseAuthClient =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

const supabaseServiceClient =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

/** Shared secret so the SPA can call `POST /api/email/welcome` right after sign-up (no JWT when email-confirm is on). Set the same value as `VITE_MEDIA_BRIDGE_WELCOME_KEY` on Vercel. */
const MEDIA_BRIDGE_WELCOME_KEY = (process.env.MEDIA_BRIDGE_WELCOME_KEY || '').trim()

const app = express()
app.set('x-powered-by', false)
app.set('trust proxy', 1)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[req] ${req.method} ${req.originalUrl || req.url}`)
  }
  next()
})
app.use(corsMiddleware)
app.options('*', corsMiddleware)
/**
 * Belt-and-suspenders: also reflect any extra headers the browser asks for in
 * `Access-Control-Request-Headers`. Some clients send custom headers (sentry,
 * tracing, etc.) that we don't list explicitly above; reflecting keeps preflight
 * green without weakening the listed defaults.
 */
app.use((req, res, next) => {
  const reqHeaders = req.headers['access-control-request-headers']
  if (reqHeaders) {
    res.setHeader('Access-Control-Allow-Headers', reqHeaders)
    res.setHeader('Vary', 'Origin, Access-Control-Request-Headers')
  }
  if (req.method === 'OPTIONS') {
    console.log(
      `[cors] preflight ${req.originalUrl || req.url} from origin=${req.headers.origin || 'n/a'} req-headers=${reqHeaders || 'n/a'}`
    )
  }
  next()
})
/**
 * Allow any embedder to load media responses cross-origin. Without this, Chrome's
 * default `Cross-Origin-Resource-Policy: same-origin` blocks the `<video>` element
 * on the Vite dev server (5173/5174/5175) from loading `/api/media/:id`.
 */
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
})

app.use(express.json({ limit: '48kb' }))
registerWelcomeEmailRoute(app, {
  supabaseAuthClient,
  supabaseServiceClient,
  welcomeKey: MEDIA_BRIDGE_WELCOME_KEY,
})

/** Cold-start / load-balancer ping: minimal work, 200 OK (Render health checks, SPA pre-warm). */
app.get('/health', (_req, res) => {
  res.status(200).setHeader('Cache-Control', 'no-store').type('application/json').send('{"ok":true}')
})

/** Optional: bridge auth snapshot (heavier — use for debugging, not for frequent pings). */
app.get('/health/verbose', (_req, res) => {
  const po = hasYoutubePoPair()
  res.json({
    ok: true,
    service: 'safetube-media-bridge',
    email: {
      resendConfigured: Boolean((process.env.RESEND_API_KEY || '').trim()),
      welcomeRouteSecretConfigured: Boolean(MEDIA_BRIDGE_WELCOME_KEY),
      pairingReminderConfigured: Boolean(supabaseServiceClient),
    },
    auth: {
      ytDlpEnabled: YT_DLP_ENABLE,
      youtubeCookiesDisabled: true,
      poTokenConfigured: Boolean(YOUTUBE_PO_TOKEN),
      visitorDataConfigured: Boolean(YOUTUBE_VISITOR_DATA),
      poPairReady: po,
    },
  })
})

/**
 * GET /api/diagnostics
 * Global, read-only system diagnostics. Reports:
 *  - the bridge's *outbound* public IP (so you can confirm whether YouTube/Piped/Invidious
 *    are blocking the Render IP specifically),
 *  - yt-dlp + ytdl-core versions, PO token / visitor_data flags,
 *  - current `auth-stale` cooldown + dead-instance cache,
 *  - parallel reachability probes against the configured Piped + Invidious instances
 *    (uses a known-public test video to avoid side effects).
 *
 * Safe to expose: never returns secret values, only counts/booleans/HTTP status.
 */
app.get('/api/diagnostics', async (_req, res) => {
  const startedAt = Date.now()
  const TEST_VIDEO_ID = 'dQw4w9WgXcQ'
  const PROBE_TIMEOUT_MS = 6_000
  const PROBE_HEADERS = {
    'user-agent': BROWSER_UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
  }

  const poDiag = {
    poTokenConfigured: Boolean(YOUTUBE_PO_TOKEN),
    visitorDataConfigured: Boolean(YOUTUBE_VISITOR_DATA),
    pairReady: hasYoutubePoPair(),
  }

  const deadSnapshot = []
  for (const [base, exp] of deadInstances.entries()) {
    if (exp > Date.now()) {
      deadSnapshot.push({
        base,
        expiresAt: new Date(exp).toISOString(),
        remainingSec: Math.max(0, Math.ceil((exp - Date.now()) / 1000)),
      })
    }
  }

  const pipedOrdered = getPipedBasesOrdered()
  const invidiousOrdered = getInvidiousBasesOrdered()

  const pipedJobs = pipedOrdered.slice(0, 8).map(async (base) => {
    if (isInstanceDead(base)) return { base, dead: true, skipped: true }
    const r = await probeUrl(`${base}/streams/${TEST_VIDEO_ID}`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      headers: PROBE_HEADERS,
    })
    return { base, dead: false, ...r }
  })
  const invidiousJobs = invidiousOrdered.slice(0, 8).map(async (base) => {
    if (isInstanceDead(base)) return { base, dead: true, skipped: true }
    const r = await probeUrl(`${base}/api/v1/videos/${TEST_VIDEO_ID}`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      headers: PROBE_HEADERS,
    })
    return { base, dead: false, ...r }
  })

  const [outboundPair, ytDlpVer, ytDirect, ytWatch, pipedProbes, invidiousProbes] = await Promise.all([
    probeOutboundIps(),
    probeYtDlpVersion(),
    probeUrl('https://www.youtube.com/', { timeoutMs: PROBE_TIMEOUT_MS, headers: PROBE_HEADERS }),
    probeUrl(`https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      headers: PROBE_HEADERS,
    }),
    Promise.all(pipedJobs),
    Promise.all(invidiousJobs),
  ])

  res.json({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    now: new Date().toISOString(),
    env: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: Math.round(process.uptime()),
      memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      host: HOST,
      port: PORT,
      corsAllowAny: MEDIA_BRIDGE_CORS_ALLOW_ANY,
      corsAllowedOriginsCount: MEDIA_BRIDGE_CORS_ALLOW_ANY ? null : ALLOWED_CORS_ORIGIN_SET.size,
      renderInstance: process.env.RENDER_INSTANCE_ID || null,
      renderRegion: process.env.RENDER_REGION || null,
      renderService: process.env.RENDER_SERVICE_NAME || null,
    },
    outbound: {
      direct: outboundPair.direct,
      /** Public IP observed when traversing OUTBOUND_PROXY (HTTP CONNECT). Often differs from Render. */
      viaProxy: outboundPair.viaProxy,
    },
    proxy: {
      disabledByEnv: OUTBOUND_PROXY_DISABLED,
      configured: Boolean(OUTBOUND_PROXY_URL),
      urlMasked: maskProxyUrl(OUTBOUND_PROXY_URL),
      httpTunnelActive: Boolean(getUndiciProxyDispatcher()),
      poTokenConfigured: Boolean(YOUTUBE_PO_TOKEN),
      visitorDataConfigured: Boolean(YOUTUBE_VISITOR_DATA),
    },
    youtubePo: poDiag,
    versions: {
      ytDlp: ytDlpVer,
      ytDlpPath: YT_DLP_PATH,
      ytDlpEnabled: YT_DLP_ENABLE,
    },
    cookies: {
      disabled: true,
      filePath: null,
      usable: false,
      hasRequiredAuthCookies: false,
      presentRequiredCookies: [],
      missingRequiredCookies: [],
      reason: 'Browser cookies disabled — use YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA',
      lastModifiedAt: null,
      ageHours: null,
      ytdlEnvCookieCount: 0,
    },
    auth: {
      stale: isYtAuthStale(),
      staleUntil: ytAuthStaleUntil ? new Date(ytAuthStaleUntil).toISOString() : null,
      staleRemainingSec: ytAuthStaleUntil
        ? Math.max(0, Math.ceil((ytAuthStaleUntil - Date.now()) / 1000))
        : 0,
    },
    deadInstances: deadSnapshot,
    cache: {
      ttlMs: STREAM_CACHE_TTL_MS,
      ttlMinutes: Math.round(STREAM_CACHE_TTL_MS / 60_000),
      size: streamCache.size,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      sets: cacheStats.sets,
      expired: cacheStats.expired,
      hitRatio:
        cacheStats.hits + cacheStats.misses > 0
          ? Number((cacheStats.hits / (cacheStats.hits + cacheStats.misses)).toFixed(3))
          : null,
    },
    instances: {
      piped: { ordered: pipedOrdered, total: pipedOrdered.length },
      invidious: { ordered: invidiousOrdered, total: invidiousOrdered.length },
    },
    probes: {
      youtube: { url: 'https://www.youtube.com/', ...ytDirect },
      youtubeWatch: { url: `https://www.youtube.com/watch?v=${TEST_VIDEO_ID}`, ...ytWatch },
      piped: pipedProbes,
      invidious: invidiousProbes,
    },
  })
})

/**
 * GET /api/diagnostics/stream/:videoId
 * Read-only diagnostics: shows which resolver path works/fails and PO token readiness.
 */
app.get('/api/diagnostics/stream/:videoId', async (req, res) => {
  const raw = req.params.videoId
  if (!raw) return res.status(400).json({ error: 'Missing videoId' })
  if (!YT_ID_RE.test(raw)) return res.status(400).json({ error: 'Invalid YouTube video id' })

  const videoId = raw
  const report = {
    ok: false,
    videoId,
    checkedAt: new Date().toISOString(),
    auth: {
      youtubeCookiesDisabled: true,
      poTokenConfigured: Boolean(YOUTUBE_PO_TOKEN),
      visitorDataConfigured: Boolean(YOUTUBE_VISITOR_DATA),
      poPairReady: hasYoutubePoPair(),
    },
    resolvers: {
      piped: { ok: false, detail: null, data: null },
      ytdl: { ok: false, detail: null, data: null },
      ytdlp: { ok: false, detail: null, data: null, attempts: [] },
    },
  }

  const ytDlpAttempts = []
  try {
    const d = await resolveViaYtDlpCli(videoId, { attempts: ytDlpAttempts })
    report.resolvers.ytdlp.ok = true
    report.resolvers.ytdlp.data = d
    report.resolvers.ytdlp.attempts = ytDlpAttempts
  } catch (e) {
    report.resolvers.ytdlp.detail = e instanceof Error ? e.message : String(e)
    report.resolvers.ytdlp.attempts = ytDlpAttempts
    if (!report.resolvers.ytdlp.attempts.length) {
      report.resolvers.ytdlp.attempts = [{ mode: 'unknown', ok: false, detail: report.resolvers.ytdlp.detail }]
    }
  }

  try {
    const p = await resolveViaPiped(videoId)
    report.resolvers.piped.ok = Boolean(p)
    report.resolvers.piped.data = p
    if (!p) report.resolvers.piped.detail = 'No usable stream from any Piped instance'
  } catch (e) {
    report.resolvers.piped.detail = e instanceof Error ? e.message : String(e)
  }

  if (YTDL_RESOLVE_ENABLE) {
    try {
      const y = await resolveViaYtdl(videoId)
      report.resolvers.ytdl.ok = true
      report.resolvers.ytdl.data = y
    } catch (e) {
      report.resolvers.ytdl.detail = e instanceof Error ? e.message : String(e)
    }
  } else {
    report.resolvers.ytdl.detail = 'skipped (set YTDL_RESOLVE_ENABLE=1 to test ytdl-core)'
  }

  report.ok =
    report.resolvers.piped.ok || report.resolvers.ytdl.ok || report.resolvers.ytdlp.ok
  return res.json(report)
})

function getPublicBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL
  const host = req.get('x-forwarded-host') || req.get('host') || `127.0.0.1:${PORT}`
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()
  return `${proto}://${host}`
}

function extractBearerToken(req) {
  const v = req.get('authorization') || ''
  const m = v.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

async function getConfirmedUserFromBearer(req) {
  if (!REQUIRE_CONFIRMED_EMAIL_FOR_STREAM) return null
  const accessToken = extractBearerToken(req)
  if (!accessToken) return null
  if (!supabaseAuthClient) {
    throw new Error('STREAM_AUTH_MISCONFIGURED: missing SUPABASE_URL/SUPABASE_ANON_KEY')
  }
  const { data, error } = await supabaseAuthClient.auth.getUser(accessToken)
  if (error || !data.user) {
    throw new Error(`STREAM_AUTH_INVALID_TOKEN: ${error?.message || 'Could not resolve user from bearer token'}`)
  }
  if (!data.user.email_confirmed_at) {
    throw new Error('EMAIL_NOT_CONFIRMED')
  }
  return data.user
}

function signStreamGrant(payload) {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, 'utf8').toString('base64url')
  const sig = createHmac('sha256', STREAM_GRANT_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyStreamGrant(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', STREAM_GRANT_SECRET).update(body).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return null
  if (!timingSafeEqual(sigBuf, expBuf)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function assertValidPlaybackGrant(req, videoId) {
  if (!REQUIRE_CONFIRMED_EMAIL_FOR_STREAM) return
  const token = String(req.query.grant || '')
  if (!token) return
  const grant = verifyStreamGrant(token)
  if (!grant || grant.videoId !== videoId || Date.now() > Number(grant.exp || 0)) {
    const err = new Error('STREAM_GRANT_INVALID')
    err.statusCode = 403
    throw err
  }
}

/**
 * GET /api/stream/:videoId — resolve and return a **proxy** URL the player should use (never a raw CDN URL).
 */
app.get('/api/stream/:videoId', async (req, res) => {
  const raw = req.params.videoId
  if (!raw) return res.status(400).json({ error: 'Missing videoId' })
  if (!YT_ID_RE.test(raw)) return res.status(400).json({ error: 'Invalid YouTube video id' })

  const videoId = raw
  try {
    const confirmedUser = await getConfirmedUserFromBearer(req)
    /**
     * Cache hit: skip the entire Piped/ytdl/yt-dlp ladder. The upstream URL
     * already lives in `streamCache` and `/api/media/:videoId` will read it
     * from there when the browser actually plays. Saves the per-request
     * resolve budget — typically the most expensive thing the bridge does.
     */
    let resolved = getCachedOrNull(videoId)
    if (!resolved) {
      resolved = await resolveUpstream(videoId)
      streamCache.set(videoId, { ...resolved, exp: Date.now() + STREAM_CACHE_TTL_MS })
      cacheStats.sets += 1
    } else {
      console.log(`[cache] hit for ${videoId} (source=${resolved.source}, ttl-remaining=${Math.max(0, Math.round((resolved.exp - Date.now()) / 1000))}s)`)
    }

    const base = getPublicBase(req)
    const playPath = `/api/media/${encodeURIComponent(videoId)}`
    let playUrl = `${base}${playPath}`
    if (confirmedUser) {
      const grant = signStreamGrant({
        sub: confirmedUser.id,
        videoId,
        exp: Date.now() + STREAM_GRANT_TTL_MS,
      })
      playUrl = `${playUrl}?grant=${encodeURIComponent(grant)}`
    }

    return res.json({
      videoId,
      url: playUrl,
      format: resolved.hls ? 'hls' : 'direct',
      mimeType: resolved.mimeType,
      quality: resolved.quality,
      source: resolved.source,
      proxied: true,
      note: 'Browser loads this app URL; the server fetches the real stream and chunks it through.',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[stream] resolve failed:', message)
    if (message.includes('EMAIL_NOT_CONFIRMED')) {
      return res.status(403).json({
        error: 'EMAIL_NOT_CONFIRMED',
        message: 'Email verification is required before playback.',
      })
    }
    if (message.includes('STREAM_AUTH_INVALID_TOKEN') || message.includes('STREAM_AUTH_MISCONFIGURED')) {
      return res.status(401).json({
        error: 'STREAM_AUTH_REQUIRED',
        detail: message,
        message: 'A valid signed-in session is required for playback.',
      })
    }
    if (isBotCheckError(message)) {
      return res.status(429).json({
        error: 'BOT_CHECK',
        detail: message,
        message:
          'YouTube requested bot verification. Refresh YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA (same session) and restart the bridge.',
        requiresAuth: true,
      })
    }
    if (isPrivateVideoError(message)) {
      return res.status(403).json({
        error: 'PRIVATE_VIDEO',
        detail: message,
        message: 'This video is private and requires an authorized YouTube account.',
        requiresAuth: true,
      })
    }
    if (isAuthRequiredError(message)) {
      return res.status(428).json({
        error: 'AUTH_COOKIES_INVALID',
        detail: message,
        message:
          'YouTube blocked this request. Set a valid YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA pair (from the same session) on the bridge.',
        requiresAuth: true,
      })
    }
    return res.status(502).json({ error: 'Could not resolve stream', detail: message })
  }
})

/**
 * One-shot proxy: fetches the resolved upstream and pipes (or rewrites m3u8) to the client.
 */
app.get('/api/media/:videoId', async (req, res) => {
  const videoId = req.params.videoId
  if (!YT_ID_RE.test(videoId)) {
    return res.status(400).json({ error: 'Invalid YouTube video id' })
  }
  try {
    assertValidPlaybackGrant(req, videoId)
  } catch (e) {
    const statusCode = Number(e?.statusCode || 403)
    return res.status(statusCode).json({
      error: 'STREAM_GRANT_INVALID',
      message: 'Playback link expired or unauthorized. Please resolve stream again.',
    })
  }

  const base = getPublicBase(req)
  let entry = getCachedOrNull(videoId)
  if (!entry) {
    try {
      const resolved = await resolveUpstream(videoId)
      entry = { ...resolved, exp: Date.now() + STREAM_CACHE_TTL_MS }
      streamCache.set(videoId, entry)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (isBotCheckError(message)) {
        return res.status(429).json({
          error: 'BOT_CHECK',
          detail: message,
          message:
          'YouTube requested bot verification. Refresh YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA (same session) and restart the bridge.',
          requiresAuth: true,
        })
      }
      if (isPrivateVideoError(message)) {
        return res.status(403).json({
          error: 'PRIVATE_VIDEO',
          detail: message,
          message: 'This video is private and requires an authorized YouTube account.',
          requiresAuth: true,
        })
      }
      if (isAuthRequiredError(message)) {
        return res.status(428).json({
          error: 'AUTH_COOKIES_INVALID',
          detail: message,
          message:
          'YouTube blocked this request. Set a valid YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA pair (from the same session) on the bridge.',
          requiresAuth: true,
        })
      }
      return res.status(502).json({ error: 'Could not resolve stream', detail: message })
    }
  }

  try {
    if (entry.hls) {
      const text = await fetchText(entry.upstreamUrl)
      if (!/^\s*#EXTM3U/i.test(text) && !text.trim().startsWith('#EXTM3U')) {
        applyMediaCorsHeaders(req, res)
        return res.status(502).type('text/plain').send('Expected m3u8 from upstream HLS url')
      }
      const body = rewriteM3u8(text, entry.upstreamUrl, base, String(req.query.grant || ''))
      applyMediaCorsHeaders(req, res)
      res.setHeader('cache-control', 'no-cache')
      return res.type('application/x-mpegURL').send(body)
    }
    return await pipeRangeResponse(req, res, entry.upstreamUrl, entry.mimeType || 'video/mp4')
  } catch (e) {
    console.error('[media]', e)
    if (!res.headersSent) {
      applyMediaCorsHeaders(req, res)
      return res.status(502).type('text/plain').send(e instanceof Error ? e.message : 'Proxy error')
    }
  }
})

/**
 * HLS: segment, variant, or sub-playlist — token never exposes the real CDN to the client.
 */
app.get('/api/segment/:token', async (req, res) => {
  const token = req.params.token
  const rec = getSegmentRec(token)
  if (!rec) {
    return res.status(404).type('text/plain').send('Unknown or expired segment token')
  }
  if (REQUIRE_CONFIRMED_EMAIL_FOR_STREAM && rec.grant) {
    const reqGrant = String(req.query.grant || '')
    if (!reqGrant || reqGrant !== (rec.grant || '')) {
      return res.status(403).type('text/plain').send('Segment grant is missing or invalid')
    }
  }

  const base = getPublicBase(req)
  try {
    const { init } = buildUpstreamInitFromReq(rec.url, req)
    const r = await bridgeFetch(rec.url, init)
    if (!r.ok) {
      return res.status(r.status).type('text/plain').send((await r.text().catch(() => '')) || r.statusText)
    }

    const finalUrl = r.url || rec.url
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    let pathLooksM3u8 = false
    try {
      pathLooksM3u8 = /\.m3u8($|[?#])/i.test(new URL(finalUrl).pathname)
    } catch {
      /* ignore */
    }
    const typeLooksM3u8 = ct.includes('mpegurl') || ct.includes('x-mpegurl') || ct.includes('m3u8')
    if (typeLooksM3u8 || pathLooksM3u8) {
      const text = await r.text()
      if (text.trimStart().startsWith('#EXTM3U')) {
        applyMediaCorsHeaders(req, res)
        res.setHeader('cache-control', 'no-cache')
        return res.type('application/x-mpegURL').send(rewriteM3u8(text, finalUrl, base, rec.grant || ''))
      }
      return res
        .status(502)
        .type('text/plain')
        .send('Invalid HLS manifest from upstream (expected #EXTM3U)')
    }
    return await pipeFetchToRes(req, res, r)
  } catch (e) {
    console.error('[segment]', e)
    if (!res.headersSent) {
      return res.status(502).type('text/plain').send(e instanceof Error ? e.message : 'Proxy error')
    }
  }
})

/** 404 — run through CORS so cross-origin fetches see JSON instead of opaque “Failed to fetch”. */
app.use((req, res) => {
  corsMiddleware(req, res, () => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found', path: req.originalUrl || req.url })
  })
})

/** Unhandled errors (e.g. async throws without try/catch) — still attach CORS headers. */
app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err)
    return
  }
  corsMiddleware(req, res, () => {
    console.error('[media-bridge] unhandled error:', err)
    const status = Number(err.statusCode || err.status || 500)
    res.status(Number.isFinite(status) ? status : 500).json({
      error: err.code || 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'Internal Server Error',
    })
  })
})

app.listen(PORT, HOST, () => {
  console.log(`[media-bridge] listening on http://${HOST}:${PORT} (all interfaces — use your LAN/public IP from other machines)`)
  console.log(`[media-bridge] local URL: http://127.0.0.1:${PORT}`)
  console.log(`[media-bridge] YouTube: browser cookies disabled — use YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA`)
  console.log(
    `[media-bridge] outbound proxy: ${
      OUTBOUND_PROXY_DISABLED
        ? 'DISABLED by env (direct egress)'
        : OUTBOUND_PROXY_URL
          ? maskProxyUrl(OUTBOUND_PROXY_URL)
          : 'NOT SET (using Render IP directly)'
    }`
  )
  if (YOUTUBE_PO_TOKEN || YOUTUBE_VISITOR_DATA) {
    const parts = []
    if (YOUTUBE_PO_TOKEN) parts.push('po_token')
    if (YOUTUBE_VISITOR_DATA) parts.push('visitor_data')
    console.log(`[media-bridge] yt-dlp extractor-args will include: ${parts.join(', ')}`)
    if (YOUTUBE_PO_TOKEN && !YOUTUBE_VISITOR_DATA) {
      console.warn(
        '[media-bridge] YOUTUBE_PO_TOKEN is set without YOUTUBE_VISITOR_DATA — YouTube usually rejects PO tokens not paired with the visitor_data that minted them.'
      )
    }
    if (YOUTUBE_VISITOR_DATA && !YOUTUBE_PO_TOKEN) {
      console.warn(
        '[media-bridge] YOUTUBE_VISITOR_DATA is set without YOUTUBE_PO_TOKEN — visitor_data alone does not bypass bot checks; set both together.'
      )
    }
  }
  if (OUTBOUND_PROXY_URL) {
    if (isHttpSchemeProxy(OUTBOUND_PROXY_URL)) {
      console.log(
        `[media-bridge] HTTP CONNECT tunnel active for Node fetch (+ CDN segment proxying). Undici dispatcher ready.`
      )
    } else {
      console.warn(
        `[media-bridge] Proxy URL is ${new URL(OUTBOUND_PROXY_URL).protocol} — only yt-dlp --proxy supports this; bridgeFetch/CDN piping still egress from Render. Prefer http://… or https://… for full tunneling.`
      )
    }
  }
  if (MEDIA_BRIDGE_CORS_ALLOW_ANY) {
    console.warn(
      '[media-bridge] CORS: ALLOW ANY origin (MEDIA_BRIDGE_CORS_ALLOW_ANY or CORS_ORIGIN=*) — not recommended on a public IP'
    )
  } else {
    console.log(
      `[media-bridge] CORS: allowlist (${ALLOWED_CORS_ORIGIN_SET.size} origins) — set MEDIA_BRIDGE_CORS_ORIGINS to add more (comma-separated)`
    )
  }
  console.log(
    `[media-bridge] Resolve: yt-dlp ${YT_DLP_ENABLE ? 'primary ' + YT_DLP_PATH : 'OFF'}; Invidious(${PREFERRED_INVIDIOUS_BASES.length} pref / ${DEFAULT_INVIDIOUS_BASES.length} total); Piped(${PREFERRED_PIPED_BASES.length} pref); ytdl-core ${YTDL_RESOLVE_ENABLE ? 'last-resort ON' : 'OFF (set YTDL_RESOLVE_ENABLE=1 to enable)'}`
  )
  console.log(
    `[media-bridge] Email: Resend ${(process.env.RESEND_API_KEY || '').trim() ? 'ON' : 'OFF (set RESEND_API_KEY)'}; welcome route secret ${MEDIA_BRIDGE_WELCOME_KEY ? 'ON' : 'OFF (set MEDIA_BRIDGE_WELCOME_KEY + VITE_MEDIA_BRIDGE_WELCOME_KEY for email-confirm signups)'}`
  )
  if (hasYoutubePoPair()) {
    console.log('[auth] YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA are set (paired for yt-dlp extractor-args)')
  } else {
    console.warn(
      '[auth] Missing PO pair — set both YOUTUBE_PO_TOKEN and YOUTUBE_VISITOR_DATA from the same session, or YouTube may return 403 / bot checks.'
    )
  }
})

// --- stream cache & tokens -------------------------------------------------

function getCachedOrNull(videoId) {
  const e = streamCache.get(videoId)
  if (!e) {
    cacheStats.misses += 1
    return null
  }
  if (Date.now() > e.exp) {
    streamCache.delete(videoId)
    cacheStats.expired += 1
    cacheStats.misses += 1
    return null
  }
  cacheStats.hits += 1
  return e
}

const urlToToken = new Map()

function allocTokenForUrl(absoluteUrl, grant = '') {
  const lookupKey = `${absoluteUrl}::${grant}`
  if (urlToToken.has(lookupKey)) {
    const existing = urlToToken.get(lookupKey)
    const r = segmentTokens.get(existing)
    if (r && Date.now() < r.exp) return existing
  }
  const token = randomBytes(16).toString('hex')
  const exp = Date.now() + SEGMENT_TOKEN_TTL_MS
  segmentTokens.set(token, { url: absoluteUrl, exp, grant })
  urlToToken.set(lookupKey, token)
  if (segmentTokens.size > 15000) {
    for (const [k, v] of segmentTokens) {
      if (Date.now() > v.exp) segmentTokens.delete(k)
    }
  }
  return token
}

function getSegmentRec(token) {
  const r = segmentTokens.get(token)
  if (!r) return null
  if (Date.now() > r.exp) {
    segmentTokens.delete(token)
    return null
  }
  return r
}

// --- resolution chain --------------------------------------------------------

async function resolveUpstream(videoId) {
  const startedAt = Date.now()
  const remaining = () => Math.max(0, OVERALL_RESOLVE_BUDGET_MS - (Date.now() - startedAt))
  let lastErr
  const poPairReady = hasYoutubePoPair()
  const authStale = isYtAuthStale()
  /**
   * Resolver order (2026-05): **yt-dlp first** whenever enabled — it returns plain URLs
   * the browser can play (yt-dlp uses direct server egress; Node fetch may still use OUTBOUND_PROXY). Invidious/Piped
   * follow as fast fallbacks. `@distube/ytdl-core` is **last and opt-in** (`YTDL_RESOLVE_ENABLE=1`)
   * because it may surface ciphered formats that trigger "Browser cannot decode the stream".
   */
  const resolverOrder = []
  if (YT_DLP_ENABLE) resolverOrder.push('ytdlp')
  resolverOrder.push('invidious', 'piped')
  if (YTDL_RESOLVE_ENABLE) resolverOrder.push('ytdl')
  console.log(
    `[resolve] order=${resolverOrder.join('->')} poPair=${poPairReady ? 'ready' : 'absent'} authStale=${authStale} ytdlCore=${YTDL_RESOLVE_ENABLE ? 'on' : 'off'}`
  )

  for (const stage of resolverOrder) {
    if (remaining() < 1_000) break
    try {
      if (stage === 'invidious') {
        const inv = await resolveViaInvidious(videoId, remaining())
        if (inv) {
          clearYtAuthStale()
          return {
            upstreamUrl: inv.url,
            hls: inv.hls,
            mimeType: inv.mimeType ?? (inv.hls ? 'application/x-mpegURL' : 'video/mp4'),
            quality: inv.quality,
            source: 'invidious',
          }
        }
      } else if (stage === 'piped') {
        const p = await resolveViaPiped(videoId, remaining())
        if (p) {
          clearYtAuthStale()
          return {
            upstreamUrl: p.url,
            hls: p.hls,
            mimeType: p.mimeType ?? (p.hls ? 'application/x-mpegURL' : 'video/mp4'),
            quality: p.quality,
            source: 'piped',
          }
        }
      } else if (stage === 'ytdl') {
        if (remaining() < 5_000) {
          console.warn(`[resolve] skipping ytdl: only ${remaining()}ms left in budget`)
          continue
        }
        const y = await resolveViaYtdl(videoId, remaining())
        clearYtAuthStale()
        return { upstreamUrl: y.url, hls: y.hls, mimeType: y.mimeType, quality: y.quality, source: 'ytdl' }
      } else if (stage === 'ytdlp') {
        if (!YT_DLP_ENABLE) continue
        if (remaining() < 5_000) {
          console.warn(`[resolve] skipping yt-dlp: only ${remaining()}ms left in budget`)
          continue
        }
        const d = await resolveViaYtDlpCli(videoId, null, remaining())
        clearYtAuthStale()
        return { upstreamUrl: d.url, hls: d.hls, mimeType: d.mimeType, quality: d.quality, source: 'ytdlp' }
      }
    } catch (e) {
      lastErr = e
      console.warn(`[resolve] ${stage} failed:`, e instanceof Error ? e.message : e)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'all backends failed within budget'))
}

function normalizePipedBase(s) {
  return s.trim().replace(/\/$/, '')
}

function normalizeInvidiousBase(s) {
  return s.trim().replace(/\/$/, '')
}

function getPipedBasesOrdered() {
  const fromEnv = (process.env.PIPED_API_BASES || '')
    .split(',')
    .map((s) => normalizePipedBase(s))
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const b of fromEnv) {
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  for (const b of PREFERRED_PIPED_BASES) {
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  const rest = shuffle(
    DEFAULT_PIPED_BASES.filter((b) => !seen.has(b))
  )
  return [...out, ...rest]
}

function getInvidiousBasesOrdered() {
  const fromEnv = (process.env.INVIDIOUS_API_BASES || '')
    .split(',')
    .map((s) => normalizeInvidiousBase(s))
    .filter(Boolean)
  const seen = new Set()
  const out = []
  for (const b of fromEnv) {
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  for (const b of PREFERRED_INVIDIOUS_BASES) {
    if (seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  const rest = shuffle(
    DEFAULT_INVIDIOUS_BASES.filter((b) => !seen.has(b))
  )
  return [...out, ...rest]
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function isPipedBlockedOrUseless(status, contentType, data, textSnippet) {
  if (status === 403 || status === 401 || status === 429) return true
  // Public Piped APIs return JSON; a 30x redirect on the API path almost
  // always means the instance migrated/retired or Cloudflare is showing us a
  // "leave us alone" page. Treat as dead so we don't burn the per-request
  // budget chasing redirects.
  if (status === 301 || status === 302 || status === 307 || status === 308) return true
  if (status >= 500) return true
  const ct = (contentType || '').toLowerCase()
  if (status === 200 && ct && !ct.includes('json') && (ct.includes('html') || ct.includes('text/plain'))) {
    if (/cloudflare|challenge|just a moment|captcha|sign in|not a bot/i.test(textSnippet)) return true
  }
  if (data && typeof data === 'object') {
    if (
      data.error &&
      typeof data.error === 'string' &&
      /unavailable|private|age|block|forbidden|bot|sign in/i.test(data.error)
    ) {
      return true
    }
    const errMsg = collectPipedErrorText(data, textSnippet)
    if (errMsg && /sign in|not a bot|forbidden|blocked|rate|quota/i.test(errMsg)) return true
    const vids = data.videoStreams
    const hasVideo = Array.isArray(vids) && vids.some((s) => s && typeof s.url === 'string' && s.url.startsWith('http'))
    const hasHls = typeof data.hls === 'string' && data.hls.startsWith('http')
    if (!hasVideo && !hasHls) return true
  }
  return false
}

function collectPipedErrorText(data, textSnippet) {
  const parts = []
  if (textSnippet) parts.push(String(textSnippet).slice(0, 2000))
  if (data && typeof data === 'object') {
    for (const k of ['error', 'message', 'description']) {
      if (typeof data[k] === 'string') parts.push(data[k])
    }
  }
  return parts.join(' ').toLowerCase()
}

async function resolveViaPiped(videoId, budgetMs = PIPED_PER_INSTANCE_TIMEOUT_MS * PIPED_MAX_INSTANCES_PER_REQUEST) {
  const startedAt = Date.now()
  const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt))
  const bases = getPipedBasesOrdered()
    .filter((b) => !isInstanceDead(b))
    .slice(0, PIPED_MAX_INSTANCES_PER_REQUEST)
  if (!bases.length) {
    console.warn('[piped] all known instances are in dead-cache, skipping')
    return null
  }
  for (const base of bases) {
    const perInstanceMs = Math.min(PIPED_PER_INSTANCE_TIMEOUT_MS, remaining())
    if (perInstanceMs < 1_000) {
      console.warn('[piped] budget exhausted, skipping remaining instances')
      break
    }
    const url = `${base}/streams/${encodeURIComponent(videoId)}`
    let r
    let textBody = ''
    try {
      r = await bridgeFetch(url, {
        method: 'GET',
        headers: PIPED_FETCH_HEADERS,
        signal: AbortSignal.timeout(perInstanceMs),
        redirect: 'follow',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[piped] ${base} request error:`, msg)
      markInstanceDead(base, `network: ${msg}`)
      continue
    }

    const contentType = r.headers.get('content-type') || ''
    if (!r.ok) {
      if (r.status === 404) continue
      if (r.status === 403 || r.status === 401 || r.status === 429) {
        console.warn(`[piped] ${base} status ${r.status}, trying next instance`)
        markInstanceDead(base, `http ${r.status}`)
        continue
      }
      if (r.status >= 500) {
        console.warn(`[piped] ${base} status ${r.status}, trying next instance`)
        markInstanceDead(base, `http ${r.status}`)
        continue
      }
      continue
    }

    try {
      textBody = await r.text()
    } catch {
      continue
    }

    if (isPipedBlockedOrUseless(r.status, contentType, null, textBody)) {
      console.warn(`[piped] ${base} blocked or non-json challenge, trying next instance`)
      continue
    }

    let data
    try {
      data = JSON.parse(textBody)
    } catch {
      if (isPipedBlockedOrUseless(r.status, contentType, null, textBody)) {
        console.warn(`[piped] ${base} could not parse JSON (likely block page), next`)
        continue
      }
      continue
    }

    const snippetForCheck = (contentType || '').toLowerCase().includes('json') ? '' : textBody
    if (isPipedBlockedOrUseless(r.status, contentType, data, snippetForCheck)) {
      console.warn(`[piped] ${base} error payload or no streams, trying next instance`)
      continue
    }

    if (!data || data.error) continue

    if (data.hls && typeof data.hls === 'string' && data.hls.startsWith('http')) {
      return { url: data.hls, hls: true, mimeType: 'application/x-mpegURL', quality: 'HLS' }
    }

    const videoStreams = Array.isArray(data.videoStreams) ? data.videoStreams : []
    const mp4Video = videoStreams
      .filter((s) => s && typeof s.url === 'string' && s.url.startsWith('http') && s.mimeType?.includes('mp4'))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
    if (mp4Video) {
      return {
        url: mp4Video.url,
        hls: false,
        mimeType: mp4Video.mimeType ?? 'video/mp4',
        quality: typeof mp4Video.quality === 'string' ? mp4Video.quality : `~${mp4Video.height}p`,
      }
    }

    const anyV = videoStreams.find((s) => s && typeof s.url === 'string' && s.url.startsWith('http'))
    if (anyV) {
      return {
        url: anyV.url,
        hls: false,
        mimeType: anyV.mimeType ?? 'video/*',
        quality: anyV.quality ? String(anyV.quality) : null,
      }
    }
  }
  return null
}

function pickInvidiousResult(payload) {
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.hlsUrl === 'string' && payload.hlsUrl.startsWith('http')) {
    return { url: payload.hlsUrl, hls: true, mimeType: 'application/x-mpegURL', quality: 'HLS' }
  }
  const streams = []
  if (Array.isArray(payload.adaptiveFormats)) streams.push(...payload.adaptiveFormats)
  if (Array.isArray(payload.formatStreams)) streams.push(...payload.formatStreams)
  const candidates = streams.filter(
    (s) =>
      s &&
      typeof s.url === 'string' &&
      s.url.startsWith('http') &&
      (String(s.type || s.mimeType || '').includes('video') || String(s.container || '').toLowerCase() === 'mp4')
  )
  if (!candidates.length) return null
  const best = [...candidates].sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0]
  const type = String(best.type || best.mimeType || '').split(';')[0].trim() || 'video/mp4'
  return {
    url: best.url,
    hls: false,
    mimeType: type,
    quality: best.qualityLabel || best.quality || null,
  }
}

async function resolveViaInvidious(videoId, budgetMs = INVIDIOUS_PER_INSTANCE_TIMEOUT_MS * INVIDIOUS_MAX_INSTANCES_PER_REQUEST) {
  const startedAt = Date.now()
  const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt))
  const bases = getInvidiousBasesOrdered()
    .filter((b) => !isInstanceDead(b))
    .slice(0, INVIDIOUS_MAX_INSTANCES_PER_REQUEST)
  if (!bases.length) {
    console.warn('[invidious] all known instances are in dead-cache, skipping')
    return null
  }
  for (const base of bases) {
    const perInstanceMs = Math.min(INVIDIOUS_PER_INSTANCE_TIMEOUT_MS, remaining())
    if (perInstanceMs < 1_000) {
      console.warn('[invidious] budget exhausted, skipping remaining instances')
      break
    }
    const url = `${base}/api/v1/videos/${encodeURIComponent(videoId)}`
    let r
    try {
      r = await bridgeFetch(url, {
        method: 'GET',
        headers: PIPED_FETCH_HEADERS,
        signal: AbortSignal.timeout(perInstanceMs),
        redirect: 'follow',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[invidious] ${base} request error:`, msg)
      markInstanceDead(base, `network: ${msg}`)
      continue
    }
    if (!r.ok) {
      if (r.status === 403 || r.status === 401 || r.status === 429 || r.status >= 500) {
        console.warn(`[invidious] ${base} status ${r.status}, trying next instance`)
        markInstanceDead(base, `http ${r.status}`)
      }
      continue
    }
    let data
    try {
      data = await r.json()
    } catch {
      continue
    }
    const picked = pickInvidiousResult(data)
    if (picked) return picked
  }
  return null
}

// --- ytdl (already @distube/ytdl-core) --------------------------------------

/** ytdl-core agent: optional outbound proxy only (no browser cookies). */
function getYtdlAgent() {
  const proxyTag = OUTBOUND_PROXY_URL ? 'proxy' : 'direct'
  const key = `${proxyTag}::no-cookies`
  if (cachedYtdlAgent.key === key && cachedYtdlAgent.agent) {
    return cachedYtdlAgent.agent
  }
  let agent = null
  if (OUTBOUND_PROXY_URL && typeof ytdl.createProxyAgent === 'function') {
    try {
      agent = ytdl.createProxyAgent({ uri: OUTBOUND_PROXY_URL }, undefined)
    } catch (err) {
      console.warn('[ytdl] createProxyAgent failed, falling back to direct:', err && err.message ? err.message : err)
    }
  }
  if (!agent && OUTBOUND_PROXY_URL && isHttpSchemeProxy(OUTBOUND_PROXY_URL)) {
    console.error(
      `[ytdl] OUTBOUND_PROXY_URL is set (${maskProxyUrl(OUTBOUND_PROXY_URL)}) but proxy agent unavailable — tunneling FAILED, falling back to direct (YouTube likely still sees server IP).`
    )
  }
  cachedYtdlAgent = { key, agent }
  const proxyMsg = OUTBOUND_PROXY_URL ? ` via proxy ${maskProxyUrl(OUTBOUND_PROXY_URL)}` : ''
  if (OUTBOUND_PROXY_URL) {
    console.log(`[ytdl] requesting${proxyMsg} (no browser cookies; use PO token + visitor_data for yt-dlp)`)
  } else {
    console.warn(
      '[ytdl] no outbound proxy — anonymous YouTube requests may rate-limit (429); yt-dlp path uses YOUTUBE_PO_TOKEN + YOUTUBE_VISITOR_DATA when set'
    )
  }
  return agent
}

function isLikelyYtdlBotError(err) {
  const m = (err && err.message) || String(err)
  return /sign in|not a bot|bot|confirm you|challeng|unavailable|login required/i.test(m)
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Generic, timeout-bounded HTTP probe used by /api/diagnostics. Returns a flat
 * `{ ok, status?, ms, error? }` object — never throws, never reads the body, so
 * we don't accidentally pull megabytes from a slow proxy.
 */
async function probeUrl(url, { timeoutMs = 6_000, method = 'GET', headers = {} } = {}) {
  const startedAt = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await bridgeFetch(url, { method, headers, signal: ctrl.signal, redirect: 'manual' })
    return {
      ok: r.ok,
      status: r.status,
      ms: Date.now() - startedAt,
    }
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function probeIpify({ dispatcher = undefined } = {}) {
  const startedAt = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5_000)
  try {
    const r = await fetch('https://api.ipify.org?format=json', {
      signal: ctrl.signal,
      ...(dispatcher ? { dispatcher } : {}),
    })
    if (!r.ok) {
      return { ok: false, status: r.status, ms: Date.now() - startedAt, ip: null }
    }
    const j = await r.json().catch(() => null)
    return { ok: true, status: 200, ms: Date.now() - startedAt, ip: (j && j.ip) || null }
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      ip: null,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `direct`: always bypasses OUTBOUND_PROXY (true Render egress).
 * `viaProxy`: undertunnel through undici ProxyAgent — should match yt-dlp's --proxy egress for HTTP proxies.
 */
async function probeOutboundIps() {
  const direct = await probeIpify()
  const d = getUndiciProxyDispatcher()
  const viaProxy = d ? await probeIpify({ dispatcher: d }) : null
  return { direct, viaProxy }
}

/**
 * Run `yt-dlp --version` to confirm the binary is wired up and report its
 * version (helpful when extractor errors hint at "update yt-dlp").
 */
function probeYtDlpVersion() {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ms: Date.now() - startedAt, ...payload })
    }
    let proc
    const timer = setTimeout(() => {
      try {
        proc?.kill('SIGKILL')
      } catch {}
      finish({ ok: false, error: 'yt-dlp --version timed out after 15s' })
    }, 15_000)
    try {
      proc = spawn(YT_DLP_PATH, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildYtDlpSpawnEnv(),
      })
    } catch (err) {
      return finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
    proc.stdout?.on('data', (b) => (stdout += String(b)))
    proc.stderr?.on('data', (b) => (stderr += String(b)))
    proc.on('error', (err) => finish({ ok: false, error: err.message }))
    proc.on('exit', (code) => {
      if (code === 0) {
        finish({ ok: true, version: stdout.trim() })
      } else {
        finish({ ok: false, exitCode: code, stderr: stderr.trim() || null })
      }
    })
  })
}

function buildYtdlGetInfoBaseOptions() {
  const agent = getYtdlAgent()
  const requestOptions = {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }
  return { requestOptions, ...(agent ? { agent } : {}) }
}

const YTDL_CLIENT_STRATEGIES = [
  ['TV', 'WEB_EMBEDDED', 'IOS', 'ANDROID', 'WEB'],
  ['WEB_EMBEDDED', 'IOS', 'ANDROID', 'TV', 'WEB'],
  ['IOS', 'ANDROID', 'TV', 'WEB_EMBEDDED', 'WEB'],
]

async function resolveViaYtdl(videoId, budgetMs = YTDL_GETINFO_TIMEOUT_MS * YTDL_CLIENT_STRATEGIES.length) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const base = buildYtdlGetInfoBaseOptions()
  const startedAt = Date.now()
  const remaining = () => Math.max(0, budgetMs - (Date.now() - startedAt))
  let lastError = new Error('ytdl: no attempt ran')

  for (const playerClients of YTDL_CLIENT_STRATEGIES) {
    const perAttemptMs = Math.min(YTDL_GETINFO_TIMEOUT_MS, remaining())
    if (perAttemptMs < 1_500) {
      console.warn('[ytdl] budget exhausted, skipping remaining strategies')
      break
    }
    try {
      const info = await withTimeout(
        ytdl.getInfo(url, {
          ...base,
          playerClients,
        }),
        perAttemptMs,
        'ytdl getInfo'
      )
      return pickYtdlFormatResult(info)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      const msg = lastError.message || ''
      if (/\b429\b|too many requests/i.test(msg)) {
        markYtAuthStaleNow('ytdl 429 (likely IP rate-limited)')
        throw lastError
      }
      if (isLikelyYtdlBotError(e)) {
        console.warn('[ytdl] strategy failed (may retry with other clients):', msg)
        continue
      }
      throw e
    }
  }
  throw lastError
}

function pickYtdlFormatResult(info) {
  const withHA = (info.formats || []).filter(
    (f) => f && f.hasVideo && f.hasAudio && f.url
  )
  for (const f of withHA) {
    if (f.isHLS && f.url) {
      return {
        url: f.url,
        hls: true,
        mimeType: f.mimeType || 'application/x-mpegURL',
        quality: f.qualityLabel || f.quality,
      }
    }
  }
  const pool = withHA.length ? withHA : info.formats || []
  let format
  if (pool.length) {
    try {
      format = ytdl.chooseFormat(pool, {
        quality: 'highest',
        filter: (f) => f && f.hasVideo && f.hasAudio && f.url && f.container === 'mp4',
      })
    } catch {
      format = null
    }
  }
  if (!format || !format.url) {
    format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' })
  }
  if (!format || !format.url) {
    throw new Error('No stream URL in ytdl formats')
  }
  if (format.isHLS) {
    return { url: format.url, hls: true, mimeType: format.mimeType || 'application/x-mpegURL', quality: format.qualityLabel }
  }
  return {
    url: format.url,
    hls: false,
    mimeType: format.mimeType ?? 'video/mp4',
    quality: format.qualityLabel ?? format.quality,
  }
}

// --- yt-dlp CLI --------------------------------------------------------------

async function resolveViaYtDlpCli(videoId, diagnostics = null, budgetMs = YT_UPSTREAM_TIMEOUT_MS) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const ytdlpStartedAt = Date.now()
  const ytdlpRemaining = () => Math.max(0, budgetMs - (Date.now() - ytdlpStartedAt))
  /** youtube:player_client selects InnerTube clients; web_embedded + mweb look less like anonymous bot traffic. */
  const rawPrimaryExtractor = (process.env.YT_DLP_PRIMARY_EXTRACTOR_ARGS || '').trim()
  const primaryExtractorArgs = rawPrimaryExtractor
    ? rawPrimaryExtractor.startsWith('youtube:')
      ? rawPrimaryExtractor
      : `youtube:${rawPrimaryExtractor}`
    : 'youtube:player_client=web'
  const baseArgs = [
    '--no-warnings',
    '--no-cookies-from-browser',
    '--no-check-certificate',
    '--socket-timeout',
    String(Math.max(5, Math.round(YT_DLP_PER_ATTEMPT_TIMEOUT_MS / 1000))),
    '--cache-dir',
    YT_DLP_CACHE_DIR,
    '--get-url',
    /**
     * `b/best` failed in production for videos that only expose adaptive (DASH) streams
     * with no combined audio+video file, raising "Requested format is not available".
     * The chain below tries: best progressive mp4 ≤720p → any best mp4 → any combined
     * file (vcodec+acodec in the same stream) → finally fall back to whatever's there.
     */
    '-f',
    'b[ext=mp4][height<=720]/b[ext=mp4]/b[acodec!=none][vcodec!=none]/b/best',
    '--user-agent',
    YT_DLP_UA,
    '--add-header',
    'Accept-Language:en-US,en;q=0.9',
  ]
  /** One --extractor-args per attempt — yt-dlp does not use separate --player-client CLI flags like some wrappers. */
  const attempts = [
    {
      name: 'web_embedded',
      args: ['--extractor-args', applyYoutubeAuthExtractorArgs(primaryExtractorArgs)],
    },
    {
      name: 'fallback_tv',
      args: [
        '--extractor-args',
        applyYoutubeAuthExtractorArgs('youtube:player_client=tv_embedded,android,ios'),
      ],
    },
  ]

  const ff = bundledFfmpegPath()
  const ffmpegArgs = ff ? ['--ffmpeg-location', ff] : []
  let lastError = null
  if (existsSync(YT_OAUTH_TOKEN_PATH)) {
    console.log(`[ytdlp][oauth2] Token loaded from secrets path: ${YT_OAUTH_TOKEN_PATH}`)
  } else {
    console.log(`[ytdlp][oauth2] Token not found yet at secrets path: ${YT_OAUTH_TOKEN_PATH}`)
  }

  for (const attempt of attempts) {
    const perAttemptMs = Math.min(YT_DLP_PER_ATTEMPT_TIMEOUT_MS, ytdlpRemaining())
    if (perAttemptMs < 2_000) {
      console.warn(`[ytdlp] budget exhausted before attempt=${attempt.name}, skipping`)
      if (diagnostics?.attempts) {
        diagnostics.attempts.push({ mode: attempt.name, ok: false, detail: 'skipped: budget exhausted' })
      }
      break
    }
    const args = [...baseArgs, ...attempt.args, ...ffmpegArgs, watchUrl]
    let stdout = ''
    try {
      const result = await runYtDlpWithRealtimeLogs(args, perAttemptMs)
      stdout = result.stdout || ''
      const stderr = result.stderr || ''
      if (stderr) console.log('[ytdlp] stderr:', stderr)
    } catch (e) {
      const stderr = typeof e === 'object' && e && 'stderr' in e ? String(e.stderr || '') : ''
      const stdoutFromErr = typeof e === 'object' && e && 'stdout' in e ? String(e.stdout || '') : ''
      if (stderr) {
        console.log('[ytdlp] stderr:', stderr)
      }
      if (stdoutFromErr) {
        console.log('[ytdlp] stdout:', stdoutFromErr)
      }
      // Surface OAuth2 device-flow hints clearly in logs.
      if (/oauth2|device|verification|enter code|google\.com\/device/i.test(`${stderr}\n${stdoutFromErr}`)) {
        console.log('[ytdlp][oauth2] Complete device auth from the URL/code above, then retry stream.')
      }
      const msg = e instanceof Error ? e.message : String(e)
      lastError = e
      if (diagnostics?.attempts) diagnostics.attempts.push({ mode: attempt.name, ok: false, detail: msg })

      const is403OrBot =
        /\b403\b/.test(msg) ||
        /http error 403|forbidden|confirm you're not a bot|sign in to confirm|bot/i.test(`${msg}\n${stderr}\n${stdoutFromErr}`)
      if (is403OrBot) {
        console.error('********** YOUTUBE 403/BOT DETECTION **********')
        console.error(`[ytdlp] attempt=${attempt.name}`)
        console.error(msg)
        console.error('***********************************************')
      }
      const looksLikeAuthGate =
        msg.includes('Private video. Sign in if you') ||
        msg.includes('Sign in to confirm you') ||
        msg.includes("confirm you're not a bot") ||
        /\b403\b/.test(msg)
      if (looksLikeAuthGate) {
        console.warn(`[ytdlp] ${attempt.name} auth/bot gate, trying next mode`)
        continue
      }
      console.warn(`[ytdlp] ${attempt.name} failed: ${msg}`)
      continue
    }
    if (existsSync(YT_OAUTH_TOKEN_PATH)) {
      console.log(`[ytdlp][oauth2] Token saved/loaded from secrets path: ${YT_OAUTH_TOKEN_PATH}`)
    }

    const lines = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const u = lines[lines.length - 1] || lines[0]
    if (!u || !u.startsWith('http')) {
      lastError = new Error(`yt-dlp attempt ${attempt.name} did not return a valid URL`)
      if (diagnostics?.attempts) {
        diagnostics.attempts.push({
          mode: attempt.name,
          ok: false,
          detail: 'yt-dlp returned no valid URL',
        })
      }
      continue
    }
    const hls = u.includes('.m3u8') || u.includes('manifest') || u.includes('playlist') || u.includes('hls')
    if (diagnostics?.attempts) diagnostics.attempts.push({ mode: attempt.name, ok: true, detail: 'resolved' })
    return {
      url: u,
      hls,
      mimeType: hls ? 'application/x-mpegURL' : 'video/mp4',
      quality: hls ? 'HLS' : 'best',
    }
  }
  throw lastError instanceof Error ? lastError : new Error('yt-dlp: all attempts failed')
}

function logYtDlpLine(kind, line) {
  const msg = String(line || '').trim()
  if (!msg) return
  if (/https?:\/\/www\.google\.com\/device/i.test(msg)) {
    console.log('********** YT-DLP OAUTH DEVICE URL **********')
    console.log(msg)
    console.log('*********************************************')
    return
  }
  if (/enter code|code[:\s]|verification|oauth2|device/i.test(msg)) {
    console.log('********** YT-DLP OAUTH DEVICE CODE **********')
    console.log(msg)
    console.log('**********************************************')
    return
  }
  console.log(`[ytdlp][${kind}] ${msg}`)
}

function attachRealtimeLineLogger(stream, kind, sink) {
  if (!stream) return () => {}
  let pending = ''
  const onData = (chunk) => {
    const text = String(chunk || '')
    if (!text) return
    sink.push(text)
    pending += text
    const parts = pending.split(/\r?\n/)
    pending = parts.pop() || ''
    for (const line of parts) logYtDlpLine(kind, line)
  }
  stream.on('data', onData)
  return () => {
    if (pending.trim()) logYtDlpLine(kind, pending.trim())
  }
}

/**
 * Child-process env for yt-dlp. Proxy vars are stripped so yt-dlp never uses
 * `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` from the host or OUTBOUND_PROXY_URL
 * (avoids 402 Payment Required from misconfigured or paid-only proxies).
 * Node `bridgeFetch` may still use OUTBOUND_PROXY_URL when set.
 */
function buildYtDlpSpawnEnv() {
  const env = { ...process.env, YT_DLP_OAUTH2_TOKEN_FILE: YT_OAUTH_TOKEN_PATH }
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[k]
  }
  return env
}

function runYtDlpWithRealtimeLogs(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const stdoutParts = []
    const stderrParts = []
    const child = spawn(YT_DLP_PATH, args, {
      windowsHide: true,
      env: buildYtDlpSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const flushStdout = attachRealtimeLineLogger(child.stdout, 'stdout', stdoutParts)
    const flushStderr = attachRealtimeLineLogger(child.stderr, 'stderr', stderrParts)

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      flushStdout()
      flushStderr()
      reject(err)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      flushStdout()
      flushStderr()
      const stdout = stdoutParts.join('')
      const stderr = stderrParts.join('')
      if (timedOut) {
        const err = new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`)
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
        return
      }
      if (code !== 0) {
        const err = new Error(`yt-dlp exited with code ${code}\n${stderr || stdout}`)
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
        return
      }
      resolve({ stdout, stderr, code })
    })
  })
}

function isPrivateVideoError(message) {
  const m = String(message || '').toLowerCase()
  return (
    m.includes('private video') ||
    m.includes('requires payment') ||
    m.includes('members-only content')
  )
}

function isBotCheckError(message) {
  const m = String(message || '').toLowerCase()
  return (
    m.includes('sign in to confirm you') ||
    m.includes("confirm you're not a bot") ||
    m.includes('confirm you are not a bot')
  )
}

function isAuthRequiredError(message) {
  const m = String(message || '').toLowerCase()
  return m.includes('youtube_auth_required') || m.includes('missing required auth cookies')
}

// --- m3u8 rewrite ------------------------------------------------------------

function resolveM3u8Uri(s, baseHref) {
  const t = s.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return new URL(t, baseHref).href
}

/**
 * @param {string} text
 * @param {string} documentBaseUrl
 * @param {string} publicBase
 */
function rewriteM3u8(text, documentBaseUrl, publicBase, grant = '') {
  const base = new URL(documentBaseUrl)
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      out.push(line)
      continue
    }
    if (line.trim().startsWith('#')) {
      if (/URI=/.test(line)) {
        out.push(rewriteUriInTagLine(line, base.href, publicBase, grant))
      } else {
        out.push(line)
      }
      continue
    }
    const abs = resolveM3u8Uri(line, base.href)
    const tok = allocTokenForUrl(abs, grant)
    const grantQ = grant ? `?grant=${encodeURIComponent(grant)}` : ''
    out.push(`${publicBase}/api/segment/${tok}${grantQ}`)
  }
  return out.join('\n')
}

function rewriteUriInTagLine(line, baseHref, publicBase, grant = '') {
  const repl = (u) => {
    const unquoted = u.replace(/^&quot;|&quot;$/g, '"')
    if (!unquoted) return u
    const abs = resolveM3u8Uri(unquoted, baseHref)
    const tok = allocTokenForUrl(abs, grant)
    const grantQ = grant ? `?grant=${encodeURIComponent(grant)}` : ''
    return `${publicBase}/api/segment/${tok}${grantQ}`
  }
  return line
    .replace(/URI="([^"]+)"/g, (_m, u) => `URI="${repl(u)}"`)
    .replace(/URI='([^']+)'/g, (_m, u) => `URI='${repl(u)}'`)
}

// --- fetch helpers & piping ---------------------------------------------------

async function fetchText(url) {
  const r = await bridgeFetch(url, { headers: UPSTREAM_MEDIA_HEADERS, redirect: 'follow' })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`M3U8 fetch ${r.status}: ${t.slice(0, 200)}`)
  }
  return r.text()
}

/**
 * @param {string} url
 * @param {import('express').Request} req
 */
function buildUpstreamInitFromReq(url, req) {
  const h = { ...UPSTREAM_MEDIA_HEADERS }
  if (req.headers.range) {
    h.range = req.headers.range
  }
  return { url, init: { headers: h, redirect: 'follow' } }
}

/** @param {import('node:fetch').Response} r */
function supportsBody(r) {
  return r.status !== 204 && r.status !== 205 && r.status !== 304
}

/**
 * @param {import('node:fetch').Response} r
 * @param {import('express').Response} res
 */
function forwardSafeHeadersToRes(r, res) {
  r.headers.forEach((v, k) => {
    const key = k.toLowerCase()
    if (['connection', 'keep-alive', 'transfer-encoding', 'trailer', 'te'].includes(key)) return
    if (key.startsWith('access-control-')) return
    res.setHeader(k, v)
  })
}

async function pipeFetchToRes(req, res, r) {
  applyMediaCorsHeaders(req, res)
  res.status(r.status)
  forwardSafeHeadersToRes(r, res)
  const hasAcceptRanges = Boolean(res.getHeader('Accept-Ranges') || res.getHeader('accept-ranges'))
  if (
    !hasAcceptRanges &&
    supportsBody(r) &&
    r.status >= 200 &&
    r.status < 300
  ) {
    res.setHeader('Accept-Ranges', 'bytes')
  }
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }
  if (supportsBody(r) && r.body) {
    Readable.fromWeb(r.body).pipe(res)
  } else {
    res.end()
  }
}

async function pipeRangeResponse(req, res, url, defaultMime) {
  const { init } = buildUpstreamInitFromReq(url, req)
  const r = await bridgeFetch(url, init)
  if (!r.ok) {
    applyMediaCorsHeaders(req, res)
    return res
      .status(r.status)
      .type('text/plain')
      .send((await r.text().catch(() => '')) || r.statusText)
  }
  if (!r.headers.get('content-type') && defaultMime) {
    res.setHeader('content-type', defaultMime)
  }
  return pipeFetchToRes(req, res, r)
}