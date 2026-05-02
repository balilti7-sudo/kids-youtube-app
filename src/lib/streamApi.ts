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

const DEFAULT_MEDIA_BRIDGE = 'https://safetube-media-bridge.onrender.com'

function parseValidHttpBaseOrNull(rawBase: string): string | null {
  const trimmed = rawBase.trim()
  if (!trimmed) return null
  const unquoted = trimmed.replace(/^['"]+|['"]+$/g, '')
  if (!unquoted) return null
  let candidate = unquoted
  if (candidate.startsWith('//')) candidate = `https:${candidate}`
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`
  }
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

/**
 * Local Media Bridge (no trailing slash). Defaults to port 8787; override with
 * `VITE_STREAM_API_BASE` if the server listens elsewhere (restart Vite after changing `.env`).
 *
 * We intentionally do **not** read `VITE_API_BASE_URL` here — that name is easy to repurpose for
 * another backend and would silently send stream requests to the wrong host.
 */
export const MEDIA_BRIDGE_BASE: string = (() => {
  const v = import.meta.env.VITE_STREAM_API_BASE?.trim() ?? ''
  const configured = parseValidHttpBaseOrNull(v)
  const defaultBase = parseValidHttpBaseOrNull(DEFAULT_MEDIA_BRIDGE) || DEFAULT_MEDIA_BRIDGE
  const base = configured || defaultBase
  if (import.meta.env.DEV) {
    console.info('[streamApi] Media Bridge base:', base)
  } else if (v.length === 0) {
    console.error(
      '[streamApi] VITE_STREAM_API_BASE is missing in production build — falling back to Render Media Bridge URL.'
    )
  } else if (!configured) {
    console.error(
      `[streamApi] VITE_STREAM_API_BASE is invalid ("${v}"). ` +
        `Expected absolute http(s) URL. Falling back to ${DEFAULT_MEDIA_BRIDGE}.`
    )
  }
  return base
})()

export function getStreamApiBaseUrl(): string {
  return MEDIA_BRIDGE_BASE.replace(/\/$/, '')
}

function buildStreamApiUrl(pathname: string): string {
  const base = getStreamApiBaseUrl()
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(pathname.replace(/^\//, ''), normalizedBase).toString()
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

/**
 * Default budget for resolving a stream via the Media Bridge (Piped / ytdl / yt-dlp).
 * Larger than the server's own resolve budget (`OVERALL_RESOLVE_BUDGET_MS`, ~70s) so the
 * server always wins the race and returns a structured response. The extra headroom
 * absorbs Render free-tier cold starts (~30–60s) for the first request after idle.
 */
const STREAM_INFO_TIMEOUT_MS = 120_000

/** Heuristic: treat these network-layer failures as "transient" and worth one auto-retry. */
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
 * Auto-retries **once** on transient network failures (`Failed to fetch` / connection reset),
 * which on Render free is almost always the cold-start blip — by the time we retry ~3s
 * later the dyno is up and the second request succeeds. Aborts (user cancellation) and
 * structured `StreamApiError`s are NOT retried.
 *
 * `credentials: 'omit'` — the bridge does not use cookies; keeps CORS simple (no preflight credential dance).
 */
export async function fetchStreamInfo(
  videoId: string,
  { signal, timeoutMs = STREAM_INFO_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<StreamApiResponse> {
  try {
    return await doFetchStreamInfo(videoId, { signal, timeoutMs })
  } catch (err) {
    if (signal?.aborted) throw err
    if (!isTransientFetchError(err)) throw err
    console.warn(
      '[streamApi] transient network error on first attempt, retrying once (likely Render cold start):',
      err instanceof Error ? err.message : err
    )
    await new Promise((r) => setTimeout(r, 3_000))
    if (signal?.aborted) throw err
    try {
      return await doFetchStreamInfo(videoId, { signal, timeoutMs })
    } catch (err2) {
      if (signal?.aborted) throw err2
      if (isTransientFetchError(err2)) {
        const base = getStreamApiBaseUrl()
        const detail = err2 instanceof Error ? err2.message : String(err2)
        throw new StreamApiError(
          `לא ניתן להתחבר לשרת הזרם (${base}). השרת עשוי להיות בהפעלה — נסו שוב בעוד מספר שניות. (${detail})`
        )
      }
      throw err2
    }
  }
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
          'הסרטון פרטי ודורש חשבון YouTube עם הרשאה מתאימה (cookies תקינים).',
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
          'YouTube זיהה אימות "לא רובוט". צריך לייצא מחדש cookies מחשבון מחובר ולנסות שוב.',
          res.status,
          detail
        )
      }
      if (res.status === 428 && errorCode === 'AUTH_COOKIES_INVALID') {
        throw new StreamApiError(
          'קובץ ה-cookies של YouTube לא תקין או פג תוקף. יש לייצא מחדש cookies.txt מחשבון מחובר.',
          res.status,
          detail
        )
      }
      throw new StreamApiError(detail ? `${errMsg}: ${detail}` : errMsg, res.status, detail)
    }
    return (await res.json()) as StreamApiResponse
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
  proxy: { configured: boolean; urlMasked: string | null; httpTunnelActive?: boolean }
  versions: { ytDlp: { ok: boolean; version?: string; error?: string } }
  cookies: {
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
