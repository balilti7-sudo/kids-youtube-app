import { supabase } from './supabase'
import { assertChildPlaybackAllowedForStream, ChildPlaybackBlockedError } from './childRuntime'
import {
  LIVE_UPCOMING_PLAYBACK_MESSAGE,
  normalizeBridgeErrorDetail,
  parseBridgeVideoInfo,
  shouldBlockLivePlayback,
  streamErrorLooksLikeUpcomingLive,
  type BridgeVideoInfo,
} from './liveStreamPolicy'

export {
  streamApiErrorIsUpcomingLive,
  UPCOMING_LIVE_LION_MESSAGE,
} from './liveStreamPolicy'

/** Response shape from `server` Media Bridge `GET /api/stream/:videoId` */
export type StreamApiResponse = {
  videoId: string
  /** Absolute URL to the media bridge (proxied) — the browser should never load a raw YouTube / CDN url */
  url: string
  format: 'direct' | 'hls'
  mimeType: string | null
  quality: string | null
  source: string
  proxied?: boolean
  note?: string
}

/** Production Media Bridge on Render (origin only — no path). */
export const CANONICAL_MEDIA_BRIDGE_ORIGIN = 'https://safetube-media-bridge.onrender.com'

const DEFAULT_MEDIA_BRIDGE = CANONICAL_MEDIA_BRIDGE_ORIGIN

/** Local Media Bridge port when using `npm run dev:api` (see vite.config.ts proxy target). */
export const LOCAL_MEDIA_BRIDGE_ORIGIN = 'http://127.0.0.1:8787'

const VITE_DEV_SERVER_PORTS = new Set(['5173', '5174', '4173'])

const VITE_PROXY_SENTINELS = new Set(['', 'vite', 'proxy', 'vite-proxy', 'local'])

function parseValidHttpBaseOrNull(rawBase: string): string | null {
  const trimmed = rawBase.trim()
  if (!trimmed) return null
  const unquoted = trimmed.replace(/^['"]+|['"]+$/g, '')
  if (!unquoted) return null
  // Emergency hardening: some deployments accidentally inject brackets in env values, e.g. "[https://host]".
  const sanitized = unquoted.replace(/[\[\]]/g, '').trim()
  if (!sanitized) return null
  let candidate = sanitized
  if (candidate.startsWith('//')) candidate = `https:${candidate}`
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`
  }
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    // Always use origin only so path/query in env cannot produce broken hosts like `…onrender.comapi`.
    return u.origin
  } catch {
    return null
  }
}

/** Reject hostnames that would cause ERR_NAME_NOT_RESOLVED (e.g. `*.onrender.comstream`). */
function isPlausibleBridgeHostname(hostname: string): boolean {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  if (h === 'localhost') return true
  // Accept any valid IPv4 literal (loopback, RFC1918, or a public IP for a self-hosted bridge).
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    return ipv4.slice(1).every((octet) => {
      const n = Number(octet)
      return Number.isInteger(n) && n >= 0 && n <= 255
    })
  }
  if (h.includes('onrender.com')) {
    return h.endsWith('.onrender.com') && h.length > '.onrender.com'.length
  }
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)
}

function coerceMediaBridgeOrigin(raw: string | null): string {
  const fallback = parseValidHttpBaseOrNull(DEFAULT_MEDIA_BRIDGE) || DEFAULT_MEDIA_BRIDGE
  if (!raw) return fallback
  let origin: string
  try {
    origin = new URL(raw).origin
  } catch {
    return fallback
  }
  let host = ''
  try {
    host = new URL(origin).hostname
  } catch {
    return fallback
  }
  if (!isPlausibleBridgeHostname(host)) {
    if (import.meta.env.DEV) {
      console.warn(
        `[streamApi] VITE_STREAM_API_BASE hostname looks invalid ("${host}") — using ${fallback}. ` +
          `Expected origin like ${CANONICAL_MEDIA_BRIDGE_ORIGIN}.`
      )
    } else {
      console.error(
        `[streamApi] Invalid Media Bridge hostname "${host}" — using ${CANONICAL_MEDIA_BRIDGE_ORIGIN}.`
      )
    }
    return fallback
  }
  return origin
}

function normalizeEnvRaw(raw: string): string {
  return raw.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase()
}

/** True when the env value is clearly the Vite app, not the Media Bridge. */
export function isLikelyFrontendDeploymentOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1') {
      const port = new URL(origin).port
      return VITE_DEV_SERVER_PORTS.has(port)
    }
    return h.endsWith('.vercel.app') || h.endsWith('.netlify.app') || h.endsWith('.pages.dev')
  } catch {
    return false
  }
}

function envImpliesViteDevProxy(envRaw: string): boolean {
  const normalized = normalizeEnvRaw(envRaw)
  if (VITE_PROXY_SENTINELS.has(normalized)) return true

  const origin = parseValidHttpBaseOrNull(envRaw)
  if (!origin) return true

  if (isLikelyFrontendDeploymentOrigin(origin)) return true

  try {
    const u = new URL(origin)
    if (u.port === '8787') return false
    if (VITE_DEV_SERVER_PORTS.has(u.port)) return true
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && !u.port) return true
  } catch {
    return true
  }

  return false
}

function viteProxyOrigin(): string {
  if (typeof window === 'undefined') {
    return parseValidHttpBaseOrNull(import.meta.env.VITE_STREAM_API_BASE ?? '') ?? LOCAL_MEDIA_BRIDGE_ORIGIN
  }
  return window.location.origin.replace(/\/$/, '')
}

/** Ephemeral quick tunnels expire; never bake them into production builds. */
function isEphemeralTryCloudflareTunnel(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.trycloudflare.com')
}

function resolveProductionBridgeOrigin(): string {
  const v = import.meta.env.VITE_STREAM_API_BASE?.trim() ?? ''
  const parsed = parseValidHttpBaseOrNull(v)
  if (!parsed) {
    console.error(
      '[streamApi] VITE_STREAM_API_BASE is missing in production — falling back to Render Media Bridge.'
    )
    return CANONICAL_MEDIA_BRIDGE_ORIGIN
  }
  try {
    if (isEphemeralTryCloudflareTunnel(new URL(parsed).hostname)) {
      console.error(
        `[streamApi] VITE_STREAM_API_BASE uses an expired ephemeral Cloudflare tunnel ("${parsed}") — ` +
          `using ${CANONICAL_MEDIA_BRIDGE_ORIGIN}. Update Vercel env to the stable bridge URL.`
      )
      return CANONICAL_MEDIA_BRIDGE_ORIGIN
    }
  } catch {
    /* fall through */
  }
  if (isLikelyFrontendDeploymentOrigin(parsed)) {
    console.error(
      `[streamApi] VITE_STREAM_API_BASE must be the Media Bridge origin, not the frontend ("${parsed}"). ` +
        `Using ${CANONICAL_MEDIA_BRIDGE_ORIGIN}.`
    )
    return CANONICAL_MEDIA_BRIDGE_ORIGIN
  }
  return coerceMediaBridgeOrigin(parsed)
}

/**
 * Origin for browser `fetch` to `/api/*` on the Media Bridge.
 *
 * - **Development:** default = same origin as Vite → `vite.config.ts` proxies `/api` → `127.0.0.1:8787`.
 *   Set `VITE_STREAM_API_USE_VITE_PROXY=true` or leave `VITE_STREAM_API_BASE` empty.
 *   Direct bridge: `VITE_STREAM_API_BASE=http://127.0.0.1:8787`
 * - **Production:** `VITE_STREAM_API_BASE` must be the bridge HTTPS origin (never Vercel/frontend).
 */
export function getMediaBridgeRequestOrigin(): string {
  const envRaw = import.meta.env.VITE_STREAM_API_BASE?.trim() ?? ''
  const useProxyFlag =
    import.meta.env.VITE_STREAM_API_USE_VITE_PROXY === 'true' ||
    import.meta.env.VITE_STREAM_API_USE_VITE_PROXY === '1'

  if (import.meta.env.DEV) {
    if (typeof window !== 'undefined') {
      if (useProxyFlag || envImpliesViteDevProxy(envRaw)) {
        if (envRaw && isLikelyFrontendDeploymentOrigin(parseValidHttpBaseOrNull(envRaw) ?? '')) {
          console.warn(
            '[streamApi] VITE_STREAM_API_BASE looks like a frontend URL — using Vite proxy for /api instead.',
            envRaw
          )
        }
        return viteProxyOrigin()
      }
      const direct = parseValidHttpBaseOrNull(envRaw)
      if (direct) return direct.replace(/\/$/, '')
      return viteProxyOrigin()
    }
    if (useProxyFlag || envImpliesViteDevProxy(envRaw)) {
      return parseValidHttpBaseOrNull(envRaw) ?? LOCAL_MEDIA_BRIDGE_ORIGIN
    }
    return (parseValidHttpBaseOrNull(envRaw) ?? LOCAL_MEDIA_BRIDGE_ORIGIN).replace(/\/$/, '')
  }

  return resolveProductionBridgeOrigin().replace(/\/$/, '')
}

/**
 * Configured Media Bridge origin (no trailing slash). Prefer `getMediaBridgeRequestOrigin()` for fetches.
 */
export function getStreamApiBaseUrl(): string {
  return getMediaBridgeRequestOrigin()
}

let mediaBridgeConfigLogged = false

/** One-time console diagnostics for Media Bridge URL resolution (dev-friendly). */
export function logMediaBridgeConfig(context: string, requestUrl?: string): void {
  const resolved = getMediaBridgeRequestOrigin()
  const payload = {
    context,
    mode: import.meta.env.DEV ? 'development' : 'production',
    viteEnv: import.meta.env.VITE_STREAM_API_BASE ?? '(unset)',
    useViteProxyFlag: import.meta.env.VITE_STREAM_API_USE_VITE_PROXY ?? '(unset)',
    resolvedOrigin: resolved,
    requestUrl: requestUrl ?? null,
    devUsesViteProxy:
      import.meta.env.DEV &&
      typeof window !== 'undefined' &&
      resolved === window.location.origin.replace(/\/$/, ''),
    proxyTargetHint: import.meta.env.DEV ? LOCAL_MEDIA_BRIDGE_ORIGIN : null,
  }
  if (import.meta.env.DEV) {
    console.info('[streamApi] Media Bridge config', payload)
    return
  }
  if (!mediaBridgeConfigLogged) {
    mediaBridgeConfigLogged = true
    console.info('[streamApi] Media Bridge config', payload)
  }
}

/**
 * Fire-and-forget GET `/health` so a sleeping Render dyno starts waking before stream playback.
 * Does not block; errors are ignored.
 */
export function preWarmMediaBridge(): void {
  if (typeof fetch === 'undefined') return
  const base = getMediaBridgeRequestOrigin()
  void fetch(`${base}/health`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    mode: 'cors',
  }).catch(() => {
    /* best-effort */
  })
}

export type StreamPlaybackQuality = '240p' | '360p' | '480p' | '720p' | '1080p'

export const STREAM_START_QUALITY: StreamPlaybackQuality = '360p'
export const STREAM_UPGRADE_QUALITY: StreamPlaybackQuality = '720p'

/** How long a successful `/api/stream` response stays reusable (proxy URL is stable per videoId). */
const STREAM_INFO_CACHE_TTL_MS = 20 * 60 * 1000

type StreamInfoCacheEntry = { data: StreamApiResponse; cachedAt: number }

const streamInfoCache = new Map<string, StreamInfoCacheEntry>()
const streamInfoInflight = new Map<string, Promise<StreamApiResponse>>()

function normalizeStreamVideoId(videoId: string): string {
  return videoId.trim()
}

function streamInfoCacheKey(videoId: string, quality?: string | null): string {
  const q = (quality || STREAM_START_QUALITY).trim().toLowerCase()
  return `${normalizeStreamVideoId(videoId)}:${q}`
}

function getCachedStreamInfo(videoId: string, quality?: string | null): StreamApiResponse | null {
  const id = normalizeStreamVideoId(videoId)
  if (!id) return null
  const key = streamInfoCacheKey(id, quality)
  const entry = streamInfoCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.cachedAt > STREAM_INFO_CACHE_TTL_MS) {
    streamInfoCache.delete(key)
    return null
  }
  return entry.data
}

function setCachedStreamInfo(videoId: string, data: StreamApiResponse, quality?: string | null): void {
  const id = normalizeStreamVideoId(videoId)
  if (!id) return
  streamInfoCache.set(streamInfoCacheKey(id, quality ?? data.quality), { data, cachedAt: Date.now() })
}

function waitForAbortSignal(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (!signal) return
    if (signal.aborted) {
      clearTimeout(t)
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

/**
 * Build `https://host/api/stream/:id` etc. via explicit join (avoids `new URL(relative, base)`
 * edge cases when base accidentally contained path fragments).
 */
export function buildMediaBridgeApiUrl(
  pathname: string,
  searchParams?: Record<string, string | null | undefined>
): string {
  const base = getMediaBridgeRequestOrigin().replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const url = new URL(`${base}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value != null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value).trim())
      }
    }
  }
  return url.toString()
}

function buildStreamApiUrl(pathname: string): string {
  return buildMediaBridgeApiUrl(pathname)
}

/** Full `GET /api/media/:videoId` URL the browser will request. */
export function getMediaBridgeMediaUrl(videoId: string, quality?: string | null): string {
  const q = (quality || STREAM_START_QUALITY).trim().toLowerCase()
  return buildMediaBridgeApiUrl(`/api/media/${encodeURIComponent(videoId.trim())}`, { quality: q })
}

/** Full `GET /api/stream/:videoId` URL the browser will request. */
export function getStreamResolveUrl(videoId: string, quality?: string | null): string {
  const q = (quality || STREAM_START_QUALITY).trim().toLowerCase()
  return buildMediaBridgeApiUrl(`/api/stream/${encodeURIComponent(videoId.trim())}`, { quality: q })
}

/** Poll `GET /api/stream/:videoId/status` while RapidAPI/CDN prepares a long video. */
export function getStreamStatusUrl(videoId: string, quality?: string | null): string {
  const q = (quality || STREAM_START_QUALITY).trim().toLowerCase()
  return buildMediaBridgeApiUrl(`/api/stream/${encodeURIComponent(videoId.trim())}/status`, {
    quality: q,
  })
}

export type StreamPrepareStatus = 'ready' | 'processing' | 'idle' | 'failed'

export type StreamStatusResponse = StreamApiResponse & {
  status?: StreamPrepareStatus
  pollUrl?: string
  retryAfterMs?: number
  elapsedMs?: number
  error?: string
  detail?: string | string[] | null
  /** `primary` | `fallback` | `processing` */
  phase?: string | null
  /** Provider currently being tried: `socialkit` | `rapidapi` */
  activeSource?: string | null
  /** Provider that failed before fallback, e.g. `rapidapi` */
  fallbackFrom?: string | null
  durationSeconds?: number | null
}

/**
 * Log the exact stream URL and bridge config when the user taps play (DevTools → Console).
 * Helps verify production points at Render and spot CORS / wrong-origin issues before fetch runs.
 */
export function logPlaybackStreamRequest(videoId: string, trigger: string): void {
  const trimmed = videoId.trim()
  if (!trimmed) return

  const bridgeOrigin = getMediaBridgeRequestOrigin()
  const streamUrl = getStreamResolveUrl(trimmed)
  const infoUrl = buildMediaBridgeApiUrl(`/api/info/${encodeURIComponent(trimmed)}`)
  const pageOrigin =
    typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '(no window)'
  const crossOrigin = pageOrigin !== '(no window)' && bridgeOrigin !== pageOrigin

  console.log('[streamApi] ▶ playback request', {
    trigger,
    videoId: trimmed,
    streamUrl,
    infoUrl,
    bridgeOrigin,
    viteEnv: import.meta.env.VITE_STREAM_API_BASE ?? '(unset)',
    useViteProxy: import.meta.env.VITE_STREAM_API_USE_VITE_PROXY ?? '(unset)',
    buildMode: import.meta.env.DEV ? 'development' : 'production',
    pageOrigin,
    crossOrigin,
    fetchWillUse: { method: 'GET', mode: 'cors', credentials: 'omit' },
    renderHint:
      bridgeOrigin === CANONICAL_MEDIA_BRIDGE_ORIGIN
        ? 'requests should appear in safetube-media-bridge Render logs'
        : `bridge origin is NOT Render canonical (${CANONICAL_MEDIA_BRIDGE_ORIGIN})`,
  })
}

function mimeToVideoJsType(mime: string | null, format: StreamApiResponse['format']): string {
  if (format === 'hls') return 'application/x-mpegURL'
  if (mime) {
    const m = mime.split(';')[0].trim().toLowerCase()
    if (m.startsWith('video/') || m === 'application/mp4') return m
  }
  return 'video/mp4'
}

/**
 * Resolves the player `src` for Video.js.
 *
 * Prefer the server-returned `url` (already proxied and may include auth/playback grant params).
 * Fall back to computed `/api/media/:videoId` path for backward compatibility.
 */
export function streamResponseToSource(data: StreamApiResponse): { src: string; type: string } {
  const src = data.url?.startsWith('http')
    ? data.url
    : getMediaBridgeMediaUrl(data.videoId, data.quality)
  return { src, type: mimeToVideoJsType(data.mimeType, data.format) }
}

/** Normalize legacy/minimal bridge JSON (`{ videoId, client, url }`) into `StreamApiResponse`. */
export function normalizeStreamApiResponse(
  body: Record<string, unknown>,
  videoId: string
): StreamApiResponse {
  const id = String(body.videoId || videoId)
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  const isUpstreamCdn = /googlevideo\.com/i.test(rawUrl)
  const inferredFormat: StreamApiResponse['format'] =
    body.format === 'hls' || body.format === 'direct'
      ? body.format
      : /\.m3u8(\?|$)/i.test(rawUrl)
        ? 'hls'
        : 'direct'

  const playbackUrl =
    rawUrl.startsWith('http') && !isUpstreamCdn
      ? rawUrl
      : getMediaBridgeMediaUrl(id)

  const mimeType =
    typeof body.mimeType === 'string' && body.mimeType.trim()
      ? body.mimeType.trim()
      : inferredFormat === 'hls'
        ? 'application/vnd.apple.mpegurl'
        : 'video/mp4'

  return {
    videoId: id,
    url: playbackUrl,
    format: inferredFormat,
    mimeType,
    quality: typeof body.quality === 'string' ? body.quality : null,
    source:
      typeof body.source === 'string'
        ? body.source
        : typeof body.client === 'string'
          ? `ytdlp:${body.client}`
          : 'bridge',
    proxied: body.proxied !== false || isUpstreamCdn,
  }
}

/**
 * Client wait budget for `GET /api/stream/:videoId` only (not `/api/info` preflight).
 * Must exceed server RapidAPI resolve + file-ready retries (~60–90s worst case) and
 * Render cold starts. Override: `VITE_STREAM_INFO_TIMEOUT_MS`.
 */
const STREAM_INFO_TIMEOUT_MS = Number(import.meta.env.VITE_STREAM_INFO_TIMEOUT_MS || 180_000)

/** Max concurrent Media Bridge fetches from this browser tab (stream + metadata). */
const MEDIA_BRIDGE_MAX_CONCURRENT = 2

let mediaBridgeInFlight = 0
const mediaBridgeWaitQueue: Array<() => void> = []

function acquireMediaBridgeSlot(): Promise<void> {
  if (mediaBridgeInFlight < MEDIA_BRIDGE_MAX_CONCURRENT) {
    mediaBridgeInFlight += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    mediaBridgeWaitQueue.push(() => {
      mediaBridgeInFlight += 1
      resolve()
    })
  })
}

function releaseMediaBridgeSlot(): void {
  mediaBridgeInFlight = Math.max(0, mediaBridgeInFlight - 1)
  const next = mediaBridgeWaitQueue.shift()
  if (next) next()
}

/** Limits parallel `/api/stream`, `/api/info`, etc. to reduce Render + RapidAPI overload. */
async function bridgeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : String(input)

  await acquireMediaBridgeSlot()
  try {
    console.log('[streamApi] bridgeFetch →', url, {
      method: init?.method ?? 'GET',
      mode: 'cors',
      credentials: init?.credentials ?? 'omit',
    })
    return await fetch(input, { ...init, mode: init?.mode ?? 'cors' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const likelyCorsOrNetwork = /Failed to fetch|NetworkError|Load failed|CORS/i.test(message)
    console.error('[streamApi] bridgeFetch failed before response', {
      url,
      message,
      likelyCorsOrNetwork,
      bridgeOrigin: getMediaBridgeRequestOrigin(),
      pageOrigin: typeof window !== 'undefined' ? window.location.origin : null,
      hint: likelyCorsOrNetwork
        ? 'Browser blocked or could not reach the bridge — check VITE_STREAM_API_BASE on Vercel and Render CORS.'
        : 'See error message above.',
    })
    throw err
  } finally {
    releaseMediaBridgeSlot()
  }
}

/** Delays before 2nd, 3rd, and 4th stream resolution attempts after `Failed to fetch` (Render cold start). */
const STREAM_TRANSIENT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const
const STREAM_RESOLVE_MAX_ATTEMPTS = 1 + STREAM_TRANSIENT_RETRY_DELAYS_MS.length

export type FetchStreamTransientRetryInfo = {
  /** Upcoming attempt number (2 = first retry after initial failure). */
  nextAttempt: number
  totalAttempts: number
  delayBeforeNextMs: number
}

export type FetchStreamFilePreparingInfo = {
  nextAttempt: number
  totalAttempts: number
  delayBeforeNextMs: number
}

/** Max client-side retries when the bridge reports the CDN file is still processing. */
const FILE_PREPARE_MAX_ATTEMPTS = 24
const FILE_PREPARE_RETRY_DELAYS_MS = [3_000, 4_000, 5_000, 6_000, 8_000, 10_000, 12_000] as const
const STREAM_STATUS_POLL_DEFAULT_MS = 3_000
const STREAM_STATUS_POLL_MAX_MS = 12_000

function isFileNotReadyStreamError(err: unknown): boolean {
  if (!(err instanceof StreamApiError)) return false
  const blob = `${err.message} ${err.detail ?? ''}`.toLowerCase()
  return (
    err.status === 503 ||
    err.status === 404 ||
    err.status === 202 ||
    /file_not_ready|file not ready|not ready after|still processing|cdn file not ready|transcoding not finished|bunny transcoding|fetch queue full/.test(blob)
  )
}

function isStreamProcessingStatus(status: unknown): boolean {
  return status === 'processing' || status === 'idle'
}

function parseStreamStatusBody(body: Record<string, unknown>, videoId: string): StreamStatusResponse {
  const status = typeof body.status === 'string' ? (body.status as StreamPrepareStatus) : undefined
  if (status === 'ready' || (body.url && body.videoId)) {
    return { ...normalizeStreamApiResponse(body, videoId), status: 'ready' }
  }
  return {
    videoId,
    url: '',
    format: 'direct',
    mimeType: null,
    quality: typeof body.quality === 'string' ? body.quality : null,
    source: typeof body.source === 'string' ? body.source : 'unknown',
    status: status ?? 'processing',
    pollUrl: typeof body.pollUrl === 'string' ? body.pollUrl : undefined,
    retryAfterMs:
      typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs)
        ? body.retryAfterMs
        : STREAM_STATUS_POLL_DEFAULT_MS,
    elapsedMs:
      typeof body.elapsedMs === 'number' && Number.isFinite(body.elapsedMs) ? body.elapsedMs : undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
    detail: normalizeBridgeErrorDetail(body.detail),
    phase: typeof body.phase === 'string' ? body.phase : null,
    activeSource: typeof body.activeSource === 'string' ? body.activeSource : null,
    fallbackFrom: typeof body.fallbackFrom === 'string' ? body.fallbackFrom : null,
    durationSeconds:
      typeof body.durationSeconds === 'number' && Number.isFinite(body.durationSeconds)
        ? body.durationSeconds
        : null,
  }
}

function streamStatusDelayMs(body: StreamStatusResponse, fallbackIndex: number): number {
  const suggested = body.retryAfterMs ?? STREAM_STATUS_POLL_DEFAULT_MS
  const backoff = FILE_PREPARE_RETRY_DELAYS_MS[fallbackIndex] ?? 12_000
  return Math.min(Math.max(suggested, backoff), STREAM_STATUS_POLL_MAX_MS)
}

async function pollStreamUntilReady(
  videoId: string,
  {
    quality,
    signal,
    onFilePreparing,
    pollUrl,
  }: {
    quality: string
    signal?: AbortSignal
    onFilePreparing?: (info: FetchStreamFilePreparingInfo) => void
    pollUrl?: string
  }
): Promise<StreamApiResponse> {
  const statusUrl = pollUrl || getStreamStatusUrl(videoId, quality)

  for (let attempt = 0; attempt < FILE_PREPARE_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      const r = signal.reason
      throw r instanceof Error ? r : new DOMException('Aborted', 'AbortError')
    }

    const res = await bridgeFetch(statusUrl, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal,
    })

    let body: Record<string, unknown>
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      body = {}
    }

    const parsed = parseStreamStatusBody(body, videoId)

    if (parsed.phase === 'transcoding' || parsed.phase === 'ingest' || parsed.activeSource === 'bunny') {
      console.info('[streamApi] Bunny Stream progress', {
        videoId,
        phase: parsed.phase,
        activeSource: parsed.activeSource,
        detail: parsed.detail,
        encodeProgress: (body as { encodeProgress?: number }).encodeProgress,
      })
    } else if (parsed.phase === 'fallback' || parsed.fallbackFrom) {
      console.info('[streamApi] provider fallback in progress', {
        videoId,
        phase: parsed.phase,
        activeSource: parsed.activeSource,
        fallbackFrom: parsed.fallbackFrom,
        detail: parsed.detail,
      })
    } else if (parsed.activeSource) {
      console.info('[streamApi] resolve progress', {
        videoId,
        activeSource: parsed.activeSource,
        phase: parsed.phase,
        detail: parsed.detail,
      })
    }

    if (parsed.status === 'ready' && parsed.url) {
      return parsed
    }

    if (!res.ok && parsed.status === 'failed') {
      const errorCode = parsed.error ?? null
      const detail = parsed.detail ?? null
      const detailBlob = `${detail ?? ''} ${errorCode ?? ''}`.toLowerCase()
      if (
        /timeout|timed out|file not ready|not ready after|still processing|cdn file not ready|transcoding not finished|bunny transcoding|econnaborted/i.test(
          detailBlob
        )
      ) {
        const delayBeforeNextMs = streamStatusDelayMs(parsed, attempt)
        onFilePreparing?.({
          nextAttempt: attempt + 2,
          totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
          delayBeforeNextMs,
        })
        await sleepWithAbort(delayBeforeNextMs, signal)
        continue
      }
      if (errorCode === 'LIVE_UPCOMING') {
        throw new StreamApiError(LIVE_UPCOMING_PLAYBACK_MESSAGE, res.status, detail)
      }
      if (errorCode === 'FILE_NOT_READY' || res.status === 503) {
        const delayBeforeNextMs = streamStatusDelayMs(parsed, attempt)
        onFilePreparing?.({
          nextAttempt: attempt + 2,
          totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
          delayBeforeNextMs,
        })
        await sleepWithAbort(delayBeforeNextMs, signal)
        continue
      }
      throw new StreamApiError(detail || `שגיאה ${res.status}`, res.status, detail)
    }

    if (!res.ok && (parsed.status === 'processing' || parsed.error === 'FILE_NOT_READY')) {
      const delayBeforeNextMs = streamStatusDelayMs(parsed, attempt)
      onFilePreparing?.({
        nextAttempt: attempt + 2,
        totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
        delayBeforeNextMs,
      })
      await sleepWithAbort(delayBeforeNextMs, signal)
      continue
    }

    if (!isStreamProcessingStatus(parsed.status) && res.ok) {
      throw new StreamApiError('Unexpected stream status response', res.status, parsed.detail ?? null)
    }

    const delayBeforeNextMs = streamStatusDelayMs(parsed, attempt)
    onFilePreparing?.({
      nextAttempt: attempt + 2,
      totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
      delayBeforeNextMs,
    })
    await sleepWithAbort(delayBeforeNextMs, signal)
  }

  throw new StreamApiError(
    'FILE_NOT_READY',
    503,
    'הסרטון עדיין בהכנה בשרת. נסו שוב בעוד דקה.'
  )
}

/** Heuristic: treat these network-layer failures as transient (multi-attempt backoff in `fetchStreamInfo`). */
function isTransientFetchError(err: unknown): boolean {
  if (err instanceof StreamApiError) return false
  if (err instanceof DOMException && err.name === 'AbortError') return false
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|ERR_NETWORK|ERR_EMPTY_RESPONSE|ERR_INTERNET_DISCONNECTED|fetch failed/i.test(
    msg
  )
}

export class StreamApiError extends Error {
  readonly status: number | null
  readonly detail: string | null
  constructor(message: string, status: number | null = null, detail: string | null = null) {
    super(message)
    this.name = 'StreamApiError'
    this.status = status
    this.detail = detail
  }
}

export { ChildPlaybackBlockedError }

export type { BridgeVideoInfo }

const VIDEO_INFO_TIMEOUT_MS = 45_000

/** Lightweight metadata from Media Bridge `/api/info/:videoId` (live status, title, duration). */
export async function fetchVideoInfo(
  videoId: string,
  {
    signal,
    timeoutMs = VIDEO_INFO_TIMEOUT_MS,
  }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<BridgeVideoInfo> {
  const url = buildStreamApiUrl(`/api/info/${encodeURIComponent(videoId)}`)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs)
  const abortForwarded = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', abortForwarded, { once: true })
  }

  try {
    const res = await bridgeFetch(url, { credentials: 'omit', headers: { accept: 'application/json' }, signal: controller.signal })
    if (!res.ok) {
      let errorCode: string | null = null
      let detail: string | null = null
      try {
        const body = (await res.json()) as { error?: string; detail?: unknown }
        errorCode = body.error ?? null
        detail = normalizeBridgeErrorDetail(body.detail)
      } catch {
        /* ignore */
      }
      if (res.status === 422 && errorCode === 'LIVE_UPCOMING') {
        throw new StreamApiError(LIVE_UPCOMING_PLAYBACK_MESSAGE, res.status, detail)
      }
      throw new StreamApiError(detail || `שגיאה ${res.status}`, res.status, detail)
    }
    const body = (await res.json()) as Record<string, unknown>
    return parseBridgeVideoInfo(body, videoId)
  } finally {
    clearTimeout(timeout)
    if (signal) signal.removeEventListener('abort', abortForwarded)
  }
}

async function assertLiveStreamPlayable(videoId: string, signal?: AbortSignal): Promise<void> {
  try {
    const info = await fetchVideoInfo(videoId, { signal })
    if (shouldBlockLivePlayback(info)) {
      throw new StreamApiError(LIVE_UPCOMING_PLAYBACK_MESSAGE, 422, info.liveStatus)
    }
  } catch (err) {
    if (err instanceof StreamApiError) throw err
    /* If metadata probe fails, fall through — stream route may still succeed or return a clearer error. */
  }
}

/**
 * Resolves a YouTube videoId to stream metadata via the bridge.
 *
 * On transient network failures (`Failed to fetch`, etc.), retries with **2s → 5s → 10s** backoff
 * (4 attempts total) — typical for Render free-tier cold starts. Aborts and `StreamApiError` are not retried.
 *
 * `credentials: 'omit'` — the bridge does not use cookies; keeps CORS simple (no preflight credential dance).
 */
async function fetchStreamInfoWithRetries(
  videoId: string,
  {
    signal,
    timeoutMs = STREAM_INFO_TIMEOUT_MS,
    quality = STREAM_START_QUALITY,
    onTransientRetry,
    onFilePreparing,
  }: {
    signal?: AbortSignal
    timeoutMs?: number
    quality?: string
    onTransientRetry?: (info: FetchStreamTransientRetryInfo) => void
    onFilePreparing?: (info: FetchStreamFilePreparingInfo) => void
  }
): Promise<StreamApiResponse> {
  let lastErr: unknown

  for (let fileAttempt = 0; fileAttempt < FILE_PREPARE_MAX_ATTEMPTS; fileAttempt++) {
    if (fileAttempt > 0) {
      const delayBeforeNextMs = FILE_PREPARE_RETRY_DELAYS_MS[fileAttempt - 1] ?? 15_000
      onFilePreparing?.({
        nextAttempt: fileAttempt + 1,
        totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
        delayBeforeNextMs,
      })
      await sleepWithAbort(delayBeforeNextMs, signal)
      if (signal?.aborted) {
        const r = signal.reason
        throw r instanceof Error ? r : new DOMException('Aborted', 'AbortError')
      }
    }

    for (let i = 0; i < STREAM_RESOLVE_MAX_ATTEMPTS; i++) {
      if (i > 0) {
        const delayBeforeNextMs = STREAM_TRANSIENT_RETRY_DELAYS_MS[i - 1]
        onTransientRetry?.({
          nextAttempt: i + 1,
          totalAttempts: STREAM_RESOLVE_MAX_ATTEMPTS,
          delayBeforeNextMs,
        })
        await sleepWithAbort(delayBeforeNextMs, signal)
        if (signal?.aborted) {
          const r = signal.reason
          throw r instanceof Error ? r : new DOMException('Aborted', 'AbortError')
        }
      }
      try {
        return await doFetchStreamInfo(videoId, { signal, timeoutMs, quality, onFilePreparing })
      } catch (err) {
        if (signal?.aborted) throw err
        if (isFileNotReadyStreamError(err)) {
          lastErr = err
          console.warn(
            '[streamApi] file still preparing on CDN, will retry stream resolve:',
            err instanceof Error ? err.message : err
          )
          onFilePreparing?.({
            nextAttempt: fileAttempt + 2,
            totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
            delayBeforeNextMs: FILE_PREPARE_RETRY_DELAYS_MS[fileAttempt] ?? 15_000,
          })
          break
        }
        if (!isTransientFetchError(err)) throw err
        lastErr = err
        const isLast = i === STREAM_RESOLVE_MAX_ATTEMPTS - 1
        if (isLast) break
        console.warn(
          '[streamApi] transient network error, scheduling retry (Render cold start?):',
          err instanceof Error ? err.message : err
        )
      }
    }

    if (lastErr && !isFileNotReadyStreamError(lastErr)) break
  }

  if (lastErr instanceof StreamApiError) throw lastErr
  if (isTransientFetchError(lastErr)) {
    const base = getStreamApiBaseUrl()
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr)
    throw new StreamApiError(
      `לא ניתן להתחבר לשרת הזרם (${base}). השרת עשוי להיות בהפעלה — נסו שוב בעוד מספר שניות. (${detail})`
    )
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * Resolves a YouTube videoId to stream metadata via the bridge.
 * Successful results are cached and in-flight requests are deduped when play is tapped twice quickly.
 */
export async function fetchStreamInfo(
  videoId: string,
  {
    signal,
    timeoutMs = STREAM_INFO_TIMEOUT_MS,
    quality = STREAM_START_QUALITY,
    onTransientRetry,
    onFilePreparing,
  }: {
    signal?: AbortSignal
    timeoutMs?: number
    /** Requested playback quality (360p start, 720p upgrade). */
    quality?: StreamPlaybackQuality | string
    /** Called before each backoff wait (not called before the first attempt). */
    onTransientRetry?: (info: FetchStreamTransientRetryInfo) => void
    /** Called when RapidAPI/CDN says the file is still being prepared — keep showing the spinner. */
    onFilePreparing?: (info: FetchStreamFilePreparingInfo) => void
  } = {}
): Promise<StreamApiResponse> {
  const id = normalizeStreamVideoId(videoId)
  if (!id) {
    throw new StreamApiError('חסר מזהה סרטון')
  }

  const requestedQuality = String(quality || STREAM_START_QUALITY).trim().toLowerCase()

  const cached = getCachedStreamInfo(id, requestedQuality)
  if (cached) {
    console.info('[streamApi] stream cache hit', { videoId: id, quality: requestedQuality })
    return cached
  }

  const inflightKey = streamInfoCacheKey(id, requestedQuality)
  const existing = streamInfoInflight.get(inflightKey)
  if (existing) {
    if (signal) {
      return Promise.race([existing, waitForAbortSignal(signal)])
    }
    return existing
  }

  const options = { signal, timeoutMs, quality: requestedQuality, onTransientRetry, onFilePreparing }
  const promise = fetchStreamInfoWithRetries(id, options)
    .then((data) => {
      setCachedStreamInfo(id, data, requestedQuality)
      return data
    })
    .finally(() => {
      streamInfoInflight.delete(inflightKey)
    })

  streamInfoInflight.set(inflightKey, promise)
  return promise
}

async function doFetchStreamInfo(
  videoId: string,
  {
    signal,
    timeoutMs,
    quality = STREAM_START_QUALITY,
    onFilePreparing,
  }: {
    signal?: AbortSignal
    timeoutMs: number
    quality?: string
    onFilePreparing?: (info: FetchStreamFilePreparingInfo) => void
  }
): Promise<StreamApiResponse> {
  await assertChildPlaybackAllowedForStream()

  // Live metadata is best-effort — do not block /api/stream (Shorts were timing out while
  // /api/info waited in the bridge queue or on RapidAPI).
  void assertLiveStreamPlayable(videoId).catch(() => {})

  const url = buildMediaBridgeApiUrl(`/api/stream/${encodeURIComponent(videoId.trim())}`, {
    quality: String(quality || STREAM_START_QUALITY).trim().toLowerCase(),
    async: '1',
  })
  logPlaybackStreamRequest(videoId, `fetchStreamInfo:${quality}:async`)

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    console.warn(`[streamApi] /api/stream timeout after ${timeoutMs}ms video=${videoId}`)
    controller.abort(new DOMException('Timeout', 'TimeoutError'))
  }, timeoutMs)
  const abortForwarded = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', abortForwarded, { once: true })
  }

  try {
    let res: Response
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const headers = new Headers({ accept: 'application/json' })
      const accessToken = session?.access_token?.trim() || ''
      // Send bearer token only when it looks like a JWT (3 dot-separated parts).
      if (accessToken && accessToken.split('.').length === 3) {
        headers.set('authorization', `Bearer ${accessToken}`)
      }
      res = await bridgeFetch(url, {
        credentials: 'omit',
        headers,
        signal: controller.signal,
      })
    } catch (e) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        if (reason instanceof DOMException && reason.name === 'TimeoutError') {
          throw new StreamApiError(`פג הזמן לפענוח זרם (${Math.round(timeoutMs / 1000)}s). נסו שוב.`)
        }
        throw reason instanceof Error ? reason : new StreamApiError('בקשת הזרם בוטלה')
      }
      throw e
    }

    clearTimeout(timeout)

    if (res.status === 202) {
      let pollUrl: string | undefined
      let retryAfterMs = STREAM_STATUS_POLL_DEFAULT_MS
      try {
        const body = (await res.json()) as Record<string, unknown>
        pollUrl = typeof body.pollUrl === 'string' ? body.pollUrl : undefined
        if (typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs)) {
          retryAfterMs = body.retryAfterMs
        }
      } catch {
        /* ignore */
      }
      onFilePreparing?.({
        nextAttempt: 2,
        totalAttempts: FILE_PREPARE_MAX_ATTEMPTS,
        delayBeforeNextMs: retryAfterMs,
      })
      return pollStreamUntilReady(videoId, {
        quality: String(quality || STREAM_START_QUALITY),
        signal,
        onFilePreparing,
        pollUrl,
      })
    }

    if (!res.ok) {
      let errMsg = `שגיאה ${res.status}`
      let detail: string | null = null
      let errorCode: string | null = null
      try {
        const body = (await res.json()) as { error?: string; detail?: unknown; message?: string }
        if (body.error) errMsg = body.error
        detail = normalizeBridgeErrorDetail(body.detail)
        if (body.error) errorCode = body.error
        if (body.message && !detail) detail = normalizeBridgeErrorDetail(body.message)
      } catch {
        /* ignore */
      }
      if (res.status === 403 && errorCode === 'PRIVATE_VIDEO') {
        throw new StreamApiError(
          'הסרטון פרטי — YouTube דורש הרשאה שלא זמינה דרך הגשר.',
          res.status,
          detail
        )
      }
      if (res.status === 403 && errorCode === 'EMAIL_NOT_CONFIRMED') {
        throw new StreamApiError(
          'צריך לאמת את כתובת האימייל לפני ניגון. בדקו את מייל האימות והתחברו מחדש.',
          res.status,
          detail
        )
      }
      if (res.status === 429 && errorCode === 'BOT_CHECK') {
        throw new StreamApiError(
          'YouTube דרש אימות "לא רובוט". יש לרענן את זוג ה-tokens (PO + visitor_data) בשרת הגשר.',
          res.status,
          detail
        )
      }
      if (res.status === 428 && errorCode === 'AUTH_COOKIES_INVALID') {
        throw new StreamApiError(
          'YouTube חסם את הבקשה. ודאו ש-SOCIALKIT_ACCESS_KEY מוגדר בשרת הגשר (Media Bridge).',
          res.status,
          detail
        )
      }
      if (res.status === 422 && errorCode === 'LIVE_UPCOMING') {
        throw new StreamApiError(LIVE_UPCOMING_PLAYBACK_MESSAGE, res.status, detail)
      }
      if (res.status === 503 && errorCode === 'FILE_NOT_READY') {
        throw new StreamApiError('FILE_NOT_READY', res.status, detail)
      }
      if (
        (res.status === 404 || res.status === 503) &&
        /file not ready|not ready|still processing/i.test(`${detail ?? ''} ${errMsg}`)
      ) {
        throw new StreamApiError('FILE_NOT_READY', res.status, detail)
      }
      if (streamErrorLooksLikeUpcomingLive(detail ?? errMsg)) {
        throw new StreamApiError(LIVE_UPCOMING_PLAYBACK_MESSAGE, res.status, detail)
      }
      throw new StreamApiError(detail ? `${errMsg}: ${detail}` : errMsg, res.status, detail)
    }
    const body = (await res.json()) as Record<string, unknown>
    return normalizeStreamApiResponse(body, videoId)
  } finally {
    clearTimeout(timeout)
    if (signal) signal.removeEventListener('abort', abortForwarded)
  }
}

/**
 * Subset of the bridge `/api/diagnostics` payload that the UI actually needs.
 * Kept narrow so adding non-UI fields server-side doesn't ripple into a TS break.
 */
export interface BridgeDiagnostics {
  ok: boolean
  elapsedMs: number
  now: string
  env?: { renderRegion?: string | null; renderService?: string | null }
  outbound: {
    /** Always direct from the Render box (no OUTBOUND_PROXY on this probe). */
    direct: { ok: boolean; ip: string | null; ms?: number; status?: number; error?: string }
    /** When an http(s) proxy is active, this is the public IP seen through the tunnel. */
    viaProxy: { ok: boolean; ip: string | null; ms?: number; status?: number; error?: string } | null
  }
  proxy: {
    configured: boolean
    urlMasked: string | null
    httpTunnelActive?: boolean
    poTokenConfigured?: boolean
    visitorDataConfigured?: boolean
  }
  youtubePo?: {
    poTokenConfigured: boolean
    visitorDataConfigured: boolean
    pairReady: boolean
  }
  versions: { ytDlp: { ok: boolean; version?: string; error?: string } }
  cookies: {
    disabled?: boolean
    usable: boolean
    hasRequiredAuthCookies: boolean
    presentRequiredCookies: string[]
    missingRequiredCookies?: string[]
    ageHours: number | null
    reason: string | null
    ytdlEnvCookieCount: number
  }
  auth: { stale: boolean; staleUntil: string | null; staleRemainingSec: number }
  cache: {
    ttlMs: number
    ttlMinutes: number
    size: number
    hits: number
    misses: number
    sets: number
    expired: number
    hitRatio: number | null
  }
  probes: {
    youtube: { ok: boolean; status?: number; ms?: number; error?: string }
    youtubeWatch: { ok: boolean; status?: number; ms?: number; error?: string }
    piped: Array<{ base: string; ok: boolean; status?: number; ms?: number; error?: string; dead?: boolean; skipped?: boolean }>
    invidious: Array<{ base: string; ok: boolean; status?: number; ms?: number; error?: string; dead?: boolean; skipped?: boolean }>
  }
}

/**
 * Read-only health snapshot of the Media Bridge. Does not require the user's
 * Supabase bearer token — the bridge whitelists this path so the UI can poll it
 * before/while the user is signed in (and from the public marketing pages).
 */
export async function fetchBridgeDiagnostics(
  { signal, timeoutMs = 10_000 }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<BridgeDiagnostics> {
  const url = buildStreamApiUrl('/api/diagnostics')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs)
  const abortForwarded = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', abortForwarded, { once: true })
  }
  try {
    const res = await fetch(url, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new StreamApiError(`Diagnostics request failed (${res.status})`, res.status)
    }
    return (await res.json()) as BridgeDiagnostics
  } finally {
    clearTimeout(timeout)
    if (signal) signal.removeEventListener('abort', abortForwarded)
  }
}
