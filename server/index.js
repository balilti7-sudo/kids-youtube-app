/**
 * Media Bridge — YouTube videoId → playable stream (Piped, @distube/ytdl-core, optional yt-dlp).
 * Streams are **proxied** through this server so the browser never requests geo/bot-protected CDNs directly.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import ytdl from '@distube/ytdl-core'
import { createClient } from '@supabase/supabase-js'

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
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
const LOCAL_DEFAULT_YT_DLP =
  process.platform === 'win32' ? path.join(SERVER_DIR, 'yt-dlp.exe') : path.join(SERVER_DIR, 'yt-dlp')
// On hosted Linux (Render/Railway), local binary may not exist on first deploy.
// Fallback to PATH-installed yt-dlp so the bridge can still resolve streams.
const DEFAULT_YT_DLP = existsSync(LOCAL_DEFAULT_YT_DLP) ? LOCAL_DEFAULT_YT_DLP : 'yt-dlp'

const PORT = Number(process.env.PORT) || 8787
const corsOptions = {
  // Open CORS for cross-origin frontend deployments (Vercel/Render/Railway).
  origin: '*',
  credentials: false,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  /**
   * IMPORTANT: per the Fetch spec, the wildcard `*` in `Access-Control-Allow-Headers`
   * does **not** cover the `Authorization` header. Our frontend sends a Supabase
   * Bearer token to `/api/stream/:videoId`, so the preflight must explicitly list
   * `Authorization` or the browser will silently strip the header and the actual
   * request is blocked with a CORS error before it ever reaches Express.
   */
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'Range', 'X-Requested-With'],
  /**
   * Expose range/length headers so the browser's `<video>` element can do native
   * seeking on `/api/media/:videoId` (direct mp4 case). Without these, Chrome
   * won't see `Content-Range` on the cross-origin response and will error.
   */
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type'],
  maxAge: 600,
}

const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS) || 50 * 60 * 1000
const SEGMENT_TOKEN_TTL_MS = Number(process.env.SEGMENT_TOKEN_TTL_MS) || 60 * 60 * 1000
const YT_DLP_PATH = (process.env.YT_DLP_PATH || DEFAULT_YT_DLP).trim()
const YT_DLP_ENABLE = (process.env.YT_DLP_ENABLE || '1').toLowerCase() === '1' || process.env.YT_DLP_ENABLE === 'true'
/** Netscape cookies export; helps yt-dlp pass YouTube bot checks when present. */
const YT_DLP_DEFAULT_COOKIES = path.join(SERVER_DIR, 'youtube.com_cookies.txt')
const RENDER_YT_COOKIES_PATH = '/etc/secrets/youtube_cookies.txt'
const WRITABLE_YT_COOKIES_PATH = '/tmp/youtube_cookies.txt'
const YT_DLP_CACHE_DIR = '/tmp/yt-dlp-cache'
const YT_OAUTH_TOKEN_PATH = (process.env.YT_OAUTH_TOKEN_PATH || '/etc/secrets/yt_oauth_token.json').trim()
const YT_UPSTREAM_TIMEOUT_MS = 60_000
/**
 * Hard ceiling for the *total* time `resolveUpstream` is allowed to spend across
 * all backends. Stays safely below the frontend's `STREAM_INFO_TIMEOUT_MS` so the
 * client always receives a structured response (success or 502) rather than a
 * generic abort/"Failed to fetch" after its own timer fires.
 */
const OVERALL_RESOLVE_BUDGET_MS = Number(process.env.OVERALL_RESOLVE_BUDGET_MS) || 70_000
/** Per-Piped-instance fetch timeout. Public instances are unstable — fail fast. */
const PIPED_PER_INSTANCE_TIMEOUT_MS = Number(process.env.PIPED_PER_INSTANCE_TIMEOUT_MS) || 8_000
/** Cap how many Piped instances we try per request so dead instances can't exhaust the budget. */
const PIPED_MAX_INSTANCES_PER_REQUEST = Number(process.env.PIPED_MAX_INSTANCES_PER_REQUEST) || 6
/** Per-strategy timeout for `ytdl.getInfo` — there are 3 strategies. */
const YTDL_GETINFO_TIMEOUT_MS = Number(process.env.YTDL_GETINFO_TIMEOUT_MS) || 20_000
/** Per-attempt timeout for the yt-dlp CLI; the resolver also enforces the overall budget. */
const YT_DLP_PER_ATTEMPT_TIMEOUT_MS = Number(process.env.YT_DLP_PER_ATTEMPT_TIMEOUT_MS) || 25_000
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
const LEGACY_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES = ['SID', 'HSID', 'SSID', 'SAPISID']
const SECURE_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES = ['__Secure-3PSID', '__Secure-3PAPISID', '__Secure-3PSIDTS']
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
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

/** Match exported cookies/browser; override in Render via YT_DLP_USER_AGENT (Chrome UA recommended). */
const CHROME_COOKIES_UA = MODERN_CHROME_UA
const YT_DLP_UA = (process.env.YT_DLP_USER_AGENT || '').trim() || CHROME_COOKIES_UA

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
const PREFERRED_PIPED_BASES = ['https://pipedapi.lunar.icu', 'https://api.vkr.dev']

const DEFAULT_PIPED_BASES = [
  'https://pipedapi.lunar.icu',
  'https://api.vkr.dev',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.privacyredirect.com',
  'https://pipedapi.privacydev.net',
  'https://pipedapi.tokhmi.xyz',
  'https://api.piped.projectsegfau.lt',
  'https://pa.mint.lgbt',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.nerdvpn.de',
  'https://api.piped.coderabbit.de',
]
const INVIDIOUS_PER_INSTANCE_TIMEOUT_MS = Number(process.env.INVIDIOUS_PER_INSTANCE_TIMEOUT_MS) || 8_000
const INVIDIOUS_MAX_INSTANCES_PER_REQUEST = Number(process.env.INVIDIOUS_MAX_INSTANCES_PER_REQUEST) || 6
const PREFERRED_INVIDIOUS_BASES = ['https://inv.nadeko.net', 'https://invidious.projectsegfau.lt']
const DEFAULT_INVIDIOUS_BASES = [
  'https://inv.nadeko.net',
  'https://invidious.projectsegfau.lt',
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

/** @type {Map<string, { url: string, exp: number, grant: string }>} */
const segmentTokens = new Map()

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/
const supabaseAuthClient =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

const app = express()
app.set('x-powered-by', false)
app.set('trust proxy', 1)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[req] ${req.method} ${req.originalUrl || req.url}`)
  }
  next()
})
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
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

app.get('/health', (_req, res) => {
  const cookiesFromEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookiesFile = cookiesFromEnv || (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  const cookies = inspectYoutubeCookiesFile(cookiesFile)
  res.json({
    ok: true,
    service: 'safetube-media-bridge',
    auth: {
      ytDlpEnabled: YT_DLP_ENABLE,
      cookiesFile: cookies.filePath || null,
      cookiesFileUsable: cookies.usable,
      hasRequiredAuthCookies: cookies.hasRequiredAuthCookies,
      presentRequiredCookies: cookies.presentRequiredCookies,
      requiredCookies: [...LEGACY_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES],
      secureRequiredCookies: [...SECURE_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES],
      cookiesReason: cookies.reason || null,
      lastModifiedAt: cookies.lastModifiedAt,
    },
  })
})

/**
 * GET /api/diagnostics/stream/:videoId
 * Read-only diagnostics: shows which resolver path works/fails and whether auth cookies are usable.
 */
app.get('/api/diagnostics/stream/:videoId', async (req, res) => {
  const raw = req.params.videoId
  if (!raw) return res.status(400).json({ error: 'Missing videoId' })
  if (!YT_ID_RE.test(raw)) return res.status(400).json({ error: 'Invalid YouTube video id' })

  const videoId = raw
  const cookiesFromEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookiesFile = cookiesFromEnv || (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  const cookieStatus = inspectYoutubeCookiesFile(cookiesFile)
  const ytdlCookieCount = parseYoutubeCookieHeader(process.env.YOUTUBE_COOKIES || process.env.YTDL_COOKIES || '').length
  const report = {
    ok: false,
    videoId,
    checkedAt: new Date().toISOString(),
    auth: {
      ytdlCookieHeaderCount: ytdlCookieCount,
      ytDlpCookiesFile: cookieStatus.filePath || null,
      ytDlpCookiesUsable: cookieStatus.usable,
      ytDlpHasRequiredAuthCookies: cookieStatus.hasRequiredAuthCookies,
      ytDlpMissingReason: cookieStatus.reason || null,
    },
    resolvers: {
      piped: { ok: false, detail: null, data: null },
      ytdl: { ok: false, detail: null, data: null },
      ytdlp: { ok: false, detail: null, data: null, attempts: [] },
    },
  }

  try {
    const p = await resolveViaPiped(videoId)
    report.resolvers.piped.ok = Boolean(p)
    report.resolvers.piped.data = p
    if (!p) report.resolvers.piped.detail = 'No usable stream from any Piped instance'
  } catch (e) {
    report.resolvers.piped.detail = e instanceof Error ? e.message : String(e)
  }

  try {
    const y = await resolveViaYtdl(videoId)
    report.resolvers.ytdl.ok = true
    report.resolvers.ytdl.data = y
  } catch (e) {
    report.resolvers.ytdl.detail = e instanceof Error ? e.message : String(e)
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

  report.ok =
    report.resolvers.piped.ok || report.resolvers.ytdl.ok || report.resolvers.ytdlp.ok
  return res.json(report)
})

function getPublicBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL
  const host = req.get('x-forwarded-host') || req.get('host') || '127.0.0.1:8787'
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
    const resolved = await resolveUpstream(videoId)
    streamCache.set(videoId, { ...resolved, exp: Date.now() + STREAM_CACHE_TTL_MS })

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
        message: 'YouTube requested bot verification. Refresh exported cookies and try again.',
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
        message: 'YouTube auth cookies are missing/expired. Export fresh cookies.txt from a signed-in browser.',
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
          message: 'YouTube requested bot verification. Refresh exported cookies and try again.',
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
          message: 'YouTube auth cookies are missing/expired. Export fresh cookies.txt from a signed-in browser.',
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
        return res.status(502).type('text/plain').send('Expected m3u8 from upstream HLS url')
      }
      const body = rewriteM3u8(text, entry.upstreamUrl, base, String(req.query.grant || ''))
      res.setHeader('cache-control', 'no-cache')
      return res.type('application/x-mpegURL').send(body)
    }
    return await pipeRangeResponse(req, res, entry.upstreamUrl, entry.mimeType || 'video/mp4')
  } catch (e) {
    console.error('[media]', e)
    if (!res.headersSent) {
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
    const r = await fetch(rec.url, init)
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
        res.setHeader('cache-control', 'no-cache')
        return res.type('application/x-mpegURL').send(rewriteM3u8(text, finalUrl, base, rec.grant || ''))
      }
      return res
        .status(502)
        .type('text/plain')
        .send('Invalid HLS manifest from upstream (expected #EXTM3U)')
    }
    return await pipeFetchToRes(res, r)
  } catch (e) {
    console.error('[segment]', e)
    if (!res.headersSent) {
      return res.status(502).type('text/plain').send(e instanceof Error ? e.message : 'Proxy error')
    }
  }
})

app.listen(PORT, () => {
  console.log(`[media-bridge] http://127.0.0.1:${PORT}`)
  const rawCookies = (process.env.YOUTUBE_COOKIES || process.env.YTDL_COOKIES || '').trim()
  const n = parseYoutubeCookieHeader(rawCookies).length
  console.log(
    `[media-bridge] YOUTUBE_COOKIES: ${n > 0 ? `loaded (${n} name=value pairs for ytdl.createAgent)` : 'not set (ytdl has no session cookies) — add to server/.env and restart'}`
  )
  console.log('[media-bridge] CORS: open (origin=*, methods/headers=all)')
  console.log(
    `[media-bridge] Invidious: preferred (${PREFERRED_INVIDIOUS_BASES.length}), total (${DEFAULT_INVIDIOUS_BASES.length}); Piped: preferred (${PREFERRED_PIPED_BASES.length}), +${DEFAULT_PIPED_BASES.length - PREFERRED_PIPED_BASES.length} fallbacks; yt-dlp(last resort): ${YT_DLP_ENABLE ? YT_DLP_PATH : 'disabled'}`
  )
  const cookiesFromEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookiesFile = cookiesFromEnv || (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  const cookies = inspectYoutubeCookiesFile(cookiesFile)
  if (!cookies.usable || !cookies.hasRequiredAuthCookies) {
    console.warn(
      `[auth] cookies not ready (${cookies.reason || 'unknown'}). If YouTube returns BOT_CHECK/PRIVATE_VIDEO, export a fresh Netscape cookies.txt from a signed-in browser.`
    )
  } else {
    console.log(
      `[auth] cookies ready (${cookies.cookieCount} entries, required auth cookies: ${cookies.presentRequiredCookies.join(', ')})`
    )
  }
})

// --- stream cache & tokens -------------------------------------------------

function getCachedOrNull(videoId) {
  const e = streamCache.get(videoId)
  if (!e) return null
  if (Date.now() > e.exp) {
    streamCache.delete(videoId)
    return null
  }
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

/**
 * Resolves an active cookies source — env header OR Netscape file. Used to dynamically
 * pick the resolver order: when YouTube cookies are present, `ytdl/yt-dlp` are dramatically
 * more reliable than Render-IP-blacklisted public Piped/Invidious mirrors.
 */
function hasUsableYoutubeAuth() {
  if ((process.env.YOUTUBE_COOKIES || process.env.YTDL_COOKIES || '').trim()) return true
  const cookieFileEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookieFilePath =
    cookieFileEnv ||
    (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  if (!cookieFilePath) return false
  const status = inspectYoutubeCookiesFile(cookieFilePath)
  return Boolean(status.usable && status.hasRequiredAuthCookies)
}

async function resolveUpstream(videoId) {
  const startedAt = Date.now()
  const remaining = () => Math.max(0, OVERALL_RESOLVE_BUDGET_MS - (Date.now() - startedAt))
  let lastErr
  const cookiesReady = hasUsableYoutubeAuth()
  /**
   * Cookie-aware ordering:
   *  - With cookies → `ytdl` (cookie-aware now) and `yt-dlp` (cookie-aware) work well
   *    even on Render's blacklisted IPs; public proxies (Piped/Invidious) are mostly dead.
   *  - Without cookies → public proxies are the only practical bypass for bot/IP blocks.
   */
  const resolverOrder = cookiesReady
    ? ['ytdl', 'ytdlp', 'invidious', 'piped']
    : ['invidious', 'piped', 'ytdl', 'ytdlp']
  console.log(`[resolve] order=${resolverOrder.join('->')} cookies=${cookiesReady ? 'ready' : 'absent'}`)

  for (const stage of resolverOrder) {
    if (remaining() < 1_000) break
    try {
      if (stage === 'invidious') {
        const inv = await resolveViaInvidious(videoId, remaining())
        if (inv) {
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
        return { upstreamUrl: y.url, hls: y.hls, mimeType: y.mimeType, quality: y.quality, source: 'ytdl' }
      } else if (stage === 'ytdlp') {
        if (!YT_DLP_ENABLE) continue
        if (remaining() < 5_000) {
          console.warn(`[resolve] skipping yt-dlp: only ${remaining()}ms left in budget`)
          continue
        }
        const d = await resolveViaYtDlpCli(videoId, null, remaining())
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
      r = await fetch(url, {
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
      r = await fetch(url, {
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

function parseYoutubeCookieHeader(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      if (i === -1) return null
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (!name) return null
      return { name, value, domain: '.youtube.com' }
    })
    .filter(Boolean)
}

/**
 * Parse a Netscape/Mozilla cookies.txt file (the same format yt-dlp consumes) into the
 * `[{name, value, domain}, ...]` shape that `@distube/ytdl-core`'s `createAgent` expects.
 * Lets us reuse the YouTube secret already mounted at `/etc/secrets/...` so `ytdl` no longer
 * hits anonymous-IP rate limits (HTTP 429) on Render.
 */
function parseNetscapeCookiesFile(filePath) {
  if (!filePath || !existsSync(filePath)) return []
  let text = ''
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  const cookies = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue
    const cleaned = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line
    const parts = cleaned.split('\t')
    if (parts.length < 7) continue
    const [domain, , path, , , name, value] = parts
    if (!name || value === undefined) continue
    cookies.push({ name, value, domain: domain || '.youtube.com', path: path || '/' })
  }
  return cookies
}

function getYtdlAgent() {
  const rawHeader = process.env.YOUTUBE_COOKIES || process.env.YTDL_COOKIES || ''
  const cookieFileEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookieFilePath =
    cookieFileEnv ||
    (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')

  const cookies = rawHeader.trim() ? parseYoutubeCookieHeader(rawHeader) : parseNetscapeCookiesFile(cookieFilePath)
  const source = rawHeader.trim() ? 'env-header' : cookieFilePath ? `file:${cookieFilePath}` : 'none'
  const key = `${source}::${cookies.length}`
  if (cachedYtdlAgent.key === key && cachedYtdlAgent.agent) {
    return cachedYtdlAgent.agent
  }
  const agent = cookies.length > 0 ? ytdl.createAgent(cookies) : null
  cachedYtdlAgent = { key, agent }
  if (cookies.length > 0) {
    console.log(`[ytdl] using cookies (count: ${cookies.length}, source: ${source})`)
  } else {
    console.warn('[ytdl] no cookies available — anonymous requests are likely to hit YouTube rate limits (429)')
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
      if (isLikelyYtdlBotError(e)) {
        console.warn('[ytdl] strategy failed (may retry with other clients):', lastError.message)
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
  const primaryExtractorArgs =
    (process.env.YT_DLP_PRIMARY_EXTRACTOR_ARGS || '').trim() || 'youtube:player_client=web'
  const cookiesFromEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const readonlyCookiesPath =
    cookiesFromEnv ||
    (existsSync(RENDER_YT_COOKIES_PATH) ? RENDER_YT_COOKIES_PATH : existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  const writableCookiesPath = ensureWritableCookies(readonlyCookiesPath)
  const baseArgs = [
    '--no-warnings',
    '--no-cookies-from-browser',
    '--no-check-certificate',
    '--cache-dir',
    YT_DLP_CACHE_DIR,
    '--get-url',
    '-f',
    'b/best',
    '--user-agent',
    YT_DLP_UA,
    '--add-header',
    'Accept-Language:en-US,en;q=0.9',
  ]
  if (writableCookiesPath) {
    baseArgs.push('--cookies', writableCookiesPath)
  } else if (readonlyCookiesPath) {
    console.warn(`[ytdlp] cookies file exists but writable copy is unavailable (${readonlyCookiesPath}); continuing without --cookies`)
  }
  const cookiesFile = writableCookiesPath || readonlyCookiesPath
  const cookieStatus = inspectYoutubeCookiesFile(cookiesFile)
  /** One --extractor-args per attempt — yt-dlp does not use separate --player-client CLI flags like some wrappers. */
  const attempts = []
  if (cookieStatus.usable && cookieStatus.hasRequiredAuthCookies) {
    attempts.push({
      name: 'cookies-web_embedded',
      args: ['--extractor-args', primaryExtractorArgs],
    })
    attempts.push({
      name: 'cookies-fallback_tv',
      args: ['--extractor-args', 'youtube:player_client=tv_embedded,android,ios'],
    })
  } else if (cookieStatus.filePath) {
    console.warn(`[ytdlp] cookies file not auth-ready (${cookieStatus.reason || 'unknown'})`)
  }
  attempts.push({
    name: 'no-cookies-web_embedded',
    args: ['--extractor-args', primaryExtractorArgs],
  })
  attempts.push({
    name: 'no-cookies-fallback_tv',
    args: ['--extractor-args', 'youtube:player_client=tv_embedded,android,ios'],
  })

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
      if (
        msg.includes('Private video. Sign in if you') ||
        msg.includes('Sign in to confirm you') ||
        msg.includes("confirm you're not a bot") ||
        /\b403\b/.test(msg)
      ) {
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

function runYtDlpWithRealtimeLogs(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const stdoutParts = []
    const stderrParts = []
    const child = spawn(YT_DLP_PATH, args, {
      windowsHide: true,
      env: {
        ...process.env,
        YT_DLP_OAUTH2_TOKEN_FILE: YT_OAUTH_TOKEN_PATH,
      },
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

function ensureWritableCookies(readonlyCookiesPath) {
  if (!readonlyCookiesPath || !existsSync(readonlyCookiesPath)) return null
  try {
    const srcStat = statSync(readonlyCookiesPath)
    let needCopy = true
    if (existsSync(WRITABLE_YT_COOKIES_PATH)) {
      const dstStat = statSync(WRITABLE_YT_COOKIES_PATH)
      needCopy = srcStat.mtimeMs > dstStat.mtimeMs
    }
    if (needCopy) {
      copyFileSync(readonlyCookiesPath, WRITABLE_YT_COOKIES_PATH)
      chmodSync(WRITABLE_YT_COOKIES_PATH, 0o600)
    }
    return WRITABLE_YT_COOKIES_PATH
  } catch (err) {
    console.error('[ytdlp] failed to prepare writable cookies copy:', err)
    return null
  }
}

function hasUsableCookiesFile(filePath) {
  if (!filePath) return false
  if (!existsSync(filePath)) return false
  try {
    return statSync(filePath).size > 100
  } catch {
    return false
  }
}

function inspectYoutubeCookiesFile(filePath) {
  const out = {
    filePath: filePath || '',
    exists: false,
    usable: false,
    cookieCount: 0,
    isNetscapeFormat: false,
    hasRequiredAuthCookies: false,
    presentRequiredCookies: [],
    reason: '',
    lastModifiedAt: null,
  }
  if (!filePath) {
    out.reason = 'cookies file path not configured'
    return out
  }
  if (!existsSync(filePath)) {
    out.reason = 'cookies file does not exist'
    return out
  }
  out.exists = true
  try {
    const st = statSync(filePath)
    out.lastModifiedAt = new Date(st.mtimeMs).toISOString()
    if (st.size <= 100) {
      out.reason = 'cookies file is too small'
      return out
    }
    const text = readFileSync(filePath, 'utf8')
    const lines = text.split(/\r?\n/)
    out.isNetscapeFormat = lines[0]?.trim() === '# Netscape HTTP Cookie File'
    if (!out.isNetscapeFormat) {
      out.reason = 'cookies file is not Netscape format'
      return out
    }
    const cookieNames = new Set()
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue
      const parts = line.split('\t')
      if (parts.length < 7) continue
      out.cookieCount += 1
      const name = (parts[5] || '').trim()
      if (name) cookieNames.add(name)
    }
    const presentLegacyRequiredCookies = LEGACY_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.filter((n) =>
      cookieNames.has(n)
    )
    const presentSecureRequiredCookies = SECURE_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.filter((n) =>
      cookieNames.has(n)
    )
    out.presentRequiredCookies = [...new Set([...presentLegacyRequiredCookies, ...presentSecureRequiredCookies])]
    const hasLegacySet = presentLegacyRequiredCookies.length === LEGACY_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.length
    const hasSecureSet = presentSecureRequiredCookies.length === SECURE_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.length
    out.hasRequiredAuthCookies = hasLegacySet || hasSecureSet
    out.usable = out.cookieCount > 0
    if (!out.usable) {
      out.reason = 'cookies file has no cookie entries'
      return out
    }
    if (!out.hasRequiredAuthCookies) {
      out.reason = `missing required auth cookies (${LEGACY_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.join(', ')}) or secure auth cookies (${SECURE_REQUIRED_YOUTUBE_AUTH_COOKIE_NAMES.join(', ')})`
      return out
    }
    out.reason = 'ok'
    return out
  } catch (e) {
    out.reason = e instanceof Error ? e.message : String(e)
    return out
  }
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
  const r = await fetch(url, { headers: UPSTREAM_MEDIA_HEADERS, redirect: 'follow' })
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
    res.setHeader(k, v)
  })
}

async function pipeFetchToRes(res, r) {
  res.status(r.status)
  forwardSafeHeadersToRes(r, res)
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
  const r = await fetch(url, init)
  if (!r.ok) {
    return res
      .status(r.status)
      .type('text/plain')
      .send((await r.text().catch(() => '')) || r.statusText)
  }
  if (!r.headers.get('content-type') && defaultMime) {
    res.setHeader('content-type', defaultMime)
  }
  return pipeFetchToRes(res, r)
}