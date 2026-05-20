import { supabase } from './supabase'

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

/**
 * Local Media Bridge (no trailing slash). Server default port is 3001; override with
 * `VITE_STREAM_API_BASE` if the server listens elsewhere (restart Vite after changing `.env`).
 *
 * We intentionally do **not** read `VITE_API_BASE_URL` here — that name is easy to repurpose for
 * another backend and would silently send stream requests to the wrong host.
 */
export const MEDIA_BRIDGE_BASE: string = (() => {
  const v = import.meta.env.VITE_STREAM_API_BASE?.trim() ?? ''
  const normalizedForParse = v.replace(/[\[\]]/g, '').trim()
  const configuredOrigin = parseValidHttpBaseOrNull(v)
  const defaultOrigin = parseValidHttpBaseOrNull(DEFAULT_MEDIA_BRIDGE) || DEFAULT_MEDIA_BRIDGE
  const base = coerceMediaBridgeOrigin(configuredOrigin || defaultOrigin)
  if (import.meta.env.DEV) {
    console.info('[streamApi] Media Bridge base:', base)
  } else if (v.length === 0) {
    console.error(
      '[streamApi] VITE_STREAM_API_BASE is missing in production build — falling back to Render Media Bridge URL.'
    )
  } else if (!configuredOrigin) {
    console.error(
      `[streamApi] VITE_STREAM_API_BASE is invalid ("${v}", sanitized="${normalizedForParse}"). ` +
        `Expected absolute http(s) origin (e.g. ${CANONICAL_MEDIA_BRIDGE_ORIGIN}). Falling back.`
    )
  }
  return base
})()

export function getStreamApiBaseUrl(): string {
  return MEDIA_BRIDGE_BASE.replace(/\/$/, '')
}

/**
 * Fire-and-forget GET `/health` so a sleeping Render dyno starts waking before stream playback.
 * Does not block; errors are ignored.
 */
export function preWarmMediaBridge(): void {
  if (typeof fetch === 'undefined') return
  const base = getStreamApiBaseUrl()
  void fetch(`${base}/health`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    mode: 'cors',
  }).catch(() => {
    /* best-effort */
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
function buildStreamApiUrl(pathname: string): string {
  const base = getStreamApiBaseUrl().replace(/\/+$/, '')
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${path}`
}

/** `GET /api/media/:videoId` on the same origin as the bridge — use for `<video src>`. */
export function getMediaBridgeMediaUrl(videoId: string): string {
  return buildStreamApiUrl(`/api/media/${encodeURIComponent(videoId)}`)
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
  const src = data.url?.startsWith('http') ? data.url : getMediaBridgeMediaUrl(data.videoId)
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
 * Default budget for resolving a stream via the Media Bridge (Piped / ytdl / yt-dlp).
 * Larger than the server's own resolve budget (`OVERALL_RESOLVE_BUDGET_MS`, ~70s) so the
 * server always wins the race and returns a structured response. The extra headroom
 * absorbs Render free-tier cold starts (~30–60s) for the first request after idle.
 */
const STREAM_INFO_TIMEOUT_MS = 120_000

/** Delays before 2nd, 3rd, and 4th stream resolution attempts after `Failed to fetch` (Render cold start). */
const STREAM_TRANSIENT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const
const STREAM_RESOLVE_MAX_ATTEMPTS = 1 + STREAM_TRANSIENT_RETRY_DELAYS_MS.length

export type FetchStreamTransientRetryInfo = {
  /** Upcoming attempt number (2 = first retry after initial failure). */
  nextAttempt: number
  totalAttempts: number
  delayBeforeNextMs: number
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

/**
 * Resolves a YouTube videoId to stream metadata via the bridge.
 *
 * On transient network failures (`Failed to fetch`, etc.), retries with **2s → 5s → 10s** backoff
 * (4 attempts total) — typical for Render free-tier cold starts. Aborts and `StreamApiError` are not retried.
 *
 * `credentials: 'omit'` — the bridge does not use cookies; keeps CORS simple (no preflight credential dance).
 */
export async function fetchStreamInfo(
  videoId: string,
  {
    signal,
    timeoutMs = STREAM_INFO_TIMEOUT_MS,
    onTransientRetry,
  }: {
    signal?: AbortSignal
    timeoutMs?: number
    /** Called before each backoff wait (not called before the first attempt). */
    onTransientRetry?: (info: FetchStreamTransientRetryInfo) => void
  } = {}
): Promise<StreamApiResponse> {
  let lastErr: unknown
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
      return await doFetchStreamInfo(videoId, { signal, timeoutMs })
    } catch (err) {
      if (signal?.aborted) throw err
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

async function doFetchStreamInfo(
  videoId: string,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number }
): Promise<StreamApiResponse> {
  const url = buildStreamApiUrl(`/api/stream/${encodeURIComponent(videoId)}`)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs)
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
      res = await fetch(url, {
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

    if (!res.ok) {
      let errMsg = `שגיאה ${res.status}`
      let detail: string | null = null
      let errorCode: string | null = null
      try {
        const body = (await res.json()) as { error?: string; detail?: string; message?: string }
        if (body.error) errMsg = body.error
        if (body.detail) detail = body.detail
        if (body.error) errorCode = body.error
        if (body.message && !detail) detail = body.message
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
          'YouTube חסם את הבקשה. ודאו ש-YOUTUBE_PO_TOKEN ו-YOUTUBE_VISITOR_DATA מוגדרים בשרת הגשר (אותה סשן).',
          res.status,
          detail
        )
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
