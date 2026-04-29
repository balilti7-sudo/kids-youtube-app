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

const DEFAULT_MEDIA_BRIDGE = 'http://localhost:8787'

/**
 * Local Media Bridge (no trailing slash). Defaults to port 8787; override with
 * `VITE_STREAM_API_BASE` if the server listens elsewhere (restart Vite after changing `.env`).
 *
 * We intentionally do **not** read `VITE_API_BASE_URL` here — that name is easy to repurpose for
 * another backend and would silently send stream requests to the wrong host.
 */
export const MEDIA_BRIDGE_BASE: string = (() => {
  const v = import.meta.env.VITE_STREAM_API_BASE?.trim() ?? ''
  const base = v.length > 0 ? v : DEFAULT_MEDIA_BRIDGE
  if (import.meta.env.DEV) {
    // Confirms the bundle is pointing at the local bridge (or your .env override); restart Vite after changing .env
    console.info('[streamApi] Media Bridge base:', base)
  }
  return base
})()

export function getStreamApiBaseUrl(): string {
  return MEDIA_BRIDGE_BASE.replace(/\/$/, '')
}

/** `GET /api/media/:videoId` on the same origin as the bridge — use for `<video src>`. */
export function getMediaBridgeMediaUrl(videoId: string): string {
  const base = getStreamApiBaseUrl()
  return `${base}/api/media/${encodeURIComponent(videoId)}`
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
 * Resolves the player `src` for Video.js. Always uses the same bridge origin as
 * `fetchStreamInfo` and always plays `GET /api/media/:videoId` — never the `url` field alone,
 * so a mistaken or legacy JSON payload cannot pass a raw YouTube / googlevideo URL to `<video>`.
 */
export function streamResponseToSource(data: StreamApiResponse): { src: string; type: string } {
  const src = getMediaBridgeMediaUrl(data.videoId)
  return { src, type: mimeToVideoJsType(data.mimeType, data.format) }
}

/** Default budget for resolving a stream via the Media Bridge (Piped / ytdl / yt-dlp). */
const STREAM_INFO_TIMEOUT_MS = 90_000

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
 * `credentials: 'omit'` — the bridge does not use cookies; keeps CORS simple (no preflight credential dance).
 */
export async function fetchStreamInfo(
  videoId: string,
  { signal, timeoutMs = STREAM_INFO_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<StreamApiResponse> {
  const base = getStreamApiBaseUrl()
  const url = `${base}/api/stream/${encodeURIComponent(videoId)}`

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
      res = await fetch(url, {
        credentials: 'omit',
        headers: { accept: 'application/json' },
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
      const msg = e instanceof Error ? e.message : String(e)
      throw new StreamApiError(
        `לא ניתן להתחבר ל־Media Bridge (${base}). ודאו ש־npm run dev:api רץ. (${msg})`
      )
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
