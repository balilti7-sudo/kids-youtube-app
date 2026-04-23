/**
 * Media Bridge — YouTube videoId → playable stream (Piped, @distube/ytdl-core, optional yt-dlp).
 * Streams are **proxied** through this server so the browser never requests geo/bot-protected CDNs directly.
 */
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import ytdl from '@distube/ytdl-core'

const execFileAsync = promisify(execFile)

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_YT_DLP =
  process.platform === 'win32' ? path.join(SERVER_DIR, 'yt-dlp.exe') : path.join(SERVER_DIR, 'yt-dlp')

const PORT = Number(process.env.PORT) || 8787
/** Local Vite dev ports + optional comma-separated extra origins via CORS_ORIGIN (e.g. production web app). */
const CORS_ALLOWED_ORIGINS = [
  ...new Set([
    'http://localhost:5175',
    'http://localhost:5174',
    'http://localhost:5173',
    ...(process.env.CORS_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '*'),
  ]),
]

const corsOptions = {
  origin: CORS_ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'HEAD', 'OPTIONS'],
}

const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS) || 50 * 60 * 1000
const SEGMENT_TOKEN_TTL_MS = Number(process.env.SEGMENT_TOKEN_TTL_MS) || 60 * 60 * 1000
const YT_DLP_PATH = (process.env.YT_DLP_PATH || DEFAULT_YT_DLP).trim()
const YT_DLP_ENABLE = (process.env.YT_DLP_ENABLE || '1').toLowerCase() === '1' || process.env.YT_DLP_ENABLE === 'true'
/** Netscape cookies export; helps yt-dlp pass YouTube bot checks when present. */
const YT_DLP_DEFAULT_COOKIES = path.join(SERVER_DIR, 'youtube.com_cookies.txt')

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

const BROWSER_UA =
  process.env.BROWSER_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

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

let cachedYtdlAgent = { key: null, agent: null }

/** @type {Map<string, { exp: number, upstreamUrl: string, hls: boolean, mimeType: string, quality: string | null, source: string }>} */
const streamCache = new Map()

/** @type {Map<string, { url: string, exp: number }>} */
const segmentTokens = new Map()

const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/

const app = express()
app.set('x-powered-by', false)
app.set('trust proxy', 1)
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'safetube-media-bridge' })
})

function getPublicBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL
  const host = req.get('x-forwarded-host') || req.get('host') || '127.0.0.1:8787'
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim()
  return `${proto}://${host}`
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
    const resolved = await resolveUpstream(videoId)
    streamCache.set(videoId, { ...resolved, exp: Date.now() + STREAM_CACHE_TTL_MS })

    const base = getPublicBase(req)
    const playPath = `/api/media/${encodeURIComponent(videoId)}`
    const playUrl = `${base}${playPath}`

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

  const base = getPublicBase(req)
  let entry = getCachedOrNull(videoId)
  if (!entry) {
    try {
      const resolved = await resolveUpstream(videoId)
      entry = { ...resolved, exp: Date.now() + STREAM_CACHE_TTL_MS }
      streamCache.set(videoId, entry)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return res.status(502).json({ error: 'Could not resolve stream', detail: message })
    }
  }

  try {
    if (entry.hls) {
      const text = await fetchText(entry.upstreamUrl)
      if (!/^\s*#EXTM3U/i.test(text) && !text.trim().startsWith('#EXTM3U')) {
        return res.status(502).type('text/plain').send('Expected m3u8 from upstream HLS url')
      }
      const body = rewriteM3u8(text, entry.upstreamUrl, base)
      res.setHeader('cache-control', 'no-cache')
      return res.type('application/vnd.apple.mpegurl').send(body)
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
        return res.type('application/vnd.apple.mpegurl').send(rewriteM3u8(text, finalUrl, base))
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
  console.log(
    `[media-bridge] Piped: preferred (${PREFERRED_PIPED_BASES.length}), +${DEFAULT_PIPED_BASES.length - PREFERRED_PIPED_BASES.length} fallbacks, yt-dlp: ${YT_DLP_ENABLE ? YT_DLP_PATH : 'disabled'}`
  )
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

function allocTokenForUrl(absoluteUrl) {
  if (urlToToken.has(absoluteUrl)) {
    const existing = urlToToken.get(absoluteUrl)
    const r = segmentTokens.get(existing)
    if (r && Date.now() < r.exp) return existing
  }
  const token = randomBytes(16).toString('hex')
  const exp = Date.now() + SEGMENT_TOKEN_TTL_MS
  segmentTokens.set(token, { url: absoluteUrl, exp })
  urlToToken.set(absoluteUrl, token)
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
  let lastErr
  try {
    const p = await resolveViaPiped(videoId)
    if (p) {
      return {
        upstreamUrl: p.url,
        hls: p.hls,
        mimeType: p.mimeType ?? (p.hls ? 'application/x-mpegURL' : 'video/mp4'),
        quality: p.quality,
        source: 'piped',
      }
    }
  } catch (e) {
    lastErr = e
    console.warn('[resolve] Piped failed:', e instanceof Error ? e.message : e)
  }
  try {
    const y = await resolveViaYtdl(videoId)
    return { upstreamUrl: y.url, hls: y.hls, mimeType: y.mimeType, quality: y.quality, source: 'ytdl' }
  } catch (e) {
    lastErr = e
    console.warn('[resolve] ytdl failed:', e instanceof Error ? e.message : e)
  }
  if (YT_DLP_ENABLE) {
    try {
      const d = await resolveViaYtDlpCli(videoId)
      return { upstreamUrl: d.url, hls: d.hls, mimeType: d.mimeType, quality: d.quality, source: 'ytdlp' }
    } catch (e) {
      lastErr = e
      console.warn('[resolve] yt-dlp failed:', e instanceof Error ? e.message : e)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'all backends failed'))
}

function normalizePipedBase(s) {
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

async function resolveViaPiped(videoId) {
  const bases = getPipedBasesOrdered()
  for (const base of bases) {
    const url = `${base}/streams/${encodeURIComponent(videoId)}`
    let r
    let textBody = ''
    try {
      r = await fetch(url, {
        method: 'GET',
        headers: PIPED_FETCH_HEADERS,
        signal: AbortSignal.timeout(20_000),
        redirect: 'follow',
      })
    } catch (e) {
      console.warn(`[piped] ${base} request error:`, e instanceof Error ? e.message : e)
      continue
    }

    const contentType = r.headers.get('content-type') || ''
    if (!r.ok) {
      if (r.status === 404) continue
      if (r.status === 403 || r.status === 401 || r.status === 429) {
        console.warn(`[piped] ${base} status ${r.status}, trying next instance`)
        continue
      }
      if (r.status >= 500) {
        console.warn(`[piped] ${base} status ${r.status}, trying next instance`)
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

function getYtdlAgent() {
  const raw = process.env.YOUTUBE_COOKIES || process.env.YTDL_COOKIES || ''
  const key = raw.trim() || 'default'
  if (cachedYtdlAgent.key === key && cachedYtdlAgent.agent) {
    return cachedYtdlAgent.agent
  }
  const cookies = parseYoutubeCookieHeader(raw)
  const agent = cookies.length > 0 ? ytdl.createAgent(cookies) : null
  cachedYtdlAgent = { key, agent }
  if (cookies.length > 0) {
    console.log('[ytdl] using YOUTUBE_COOKIES (count:', cookies.length, ')')
  }
  return agent
}

function isLikelyYtdlBotError(err) {
  const m = (err && err.message) || String(err)
  return /sign in|not a bot|bot|confirm you|challeng|unavailable|login required/i.test(m)
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

async function resolveViaYtdl(videoId) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const base = buildYtdlGetInfoBaseOptions()
  let lastError = new Error('ytdl: no attempt ran')

  for (const playerClients of YTDL_CLIENT_STRATEGIES) {
    try {
      const info = await ytdl.getInfo(url, {
        ...base,
        playerClients,
      })
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

async function resolveViaYtDlpCli(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  const args = ['--no-warnings', '--get-url', '-f', 'b/best']
  const cookiesFromEnv = (process.env.YOUTUBE_COOKIES_FILE || '').trim()
  const cookiesFile =
    cookiesFromEnv || (existsSync(YT_DLP_DEFAULT_COOKIES) ? YT_DLP_DEFAULT_COOKIES : '')
  if (cookiesFile) {
    args.push('--cookies', cookiesFile)
  }
  const ff = bundledFfmpegPath()
  if (ff) {
    args.push('--ffmpeg-location', ff)
  }
  args.push(watchUrl)
  const { stdout } = await execFileAsync(YT_DLP_PATH, args, {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  })
  const lines = stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const u = lines[lines.length - 1] || lines[0]
  if (!u || !u.startsWith('http')) {
    throw new Error('yt-dlp did not return a url')
  }
  const hls = u.includes('.m3u8') || u.includes('manifest') || u.includes('playlist') || u.includes('hls')
  return {
    url: u,
    hls,
    mimeType: hls ? 'application/x-mpegURL' : 'video/mp4',
    quality: hls ? 'HLS' : 'best',
  }
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
function rewriteM3u8(text, documentBaseUrl, publicBase) {
  const base = new URL(documentBaseUrl)
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      out.push(line)
      continue
    }
    if (line.trim().startsWith('#')) {
      if (/URI=/.test(line)) {
        out.push(rewriteUriInTagLine(line, base.href, publicBase))
      } else {
        out.push(line)
      }
      continue
    }
    const abs = resolveM3u8Uri(line, base.href)
    const tok = allocTokenForUrl(abs)
    out.push(`${publicBase}/api/segment/${tok}`)
  }
  return out.join('\n')
}

function rewriteUriInTagLine(line, baseHref, publicBase) {
  const repl = (u) => {
    const unquoted = u.replace(/^&quot;|&quot;$/g, '"')
    if (!unquoted) return u
    const abs = resolveM3u8Uri(unquoted, baseHref)
    const tok = allocTokenForUrl(abs)
    return `${publicBase}/api/segment/${tok}`
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