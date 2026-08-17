/**
 * hls.js loader that fetches YouTube HLS playlists/segments through CapacitorHttp.
 *
 * Chromium WebView sends `Referer: https://localhost` for `<video>` / XHR media.
 * googlevideo then serves the first chunk and 403s the rest — playback freezes with
 * no `error` event. Native HTTP with YouTube's own Referer/Origin keeps the bytes
 * on-device and lets Range/segment requests complete.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js'

export const YOUTUBE_MEDIA_ORIGIN = 'https://www.youtube.com'
export const YOUTUBE_MEDIA_REFERER = 'https://www.youtube.com/'
/** Matches youtubei.js IOS client enough for googlevideo HLS minted via InnerTube IOS. */
export const YOUTUBE_IOS_APP_UA =
  'com.google.ios.youtube/20.11.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X) gzip'

export function shouldUseNativeYoutubeHlsLoader(): boolean {
  return Capacitor.isNativePlatform()
}

function emptyStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  }
}

function wantsBinary(responseType: XMLHttpRequestResponseType | string | undefined): boolean {
  return responseType === 'arraybuffer' || responseType === 'blob'
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
  }
  if (typeof data === 'string') {
    const trimmed = data.trim()
    if (!trimmed) return new ArrayBuffer(0)
    try {
      return decodeBase64ToArrayBuffer(trimmed)
    } catch {
      const bytes = new TextEncoder().encode(data)
      return bytes.buffer
    }
  }
  if (data && typeof data === 'object' && 'byteLength' in (data as object)) {
    return toArrayBuffer(new Uint8Array(data as ArrayLike<number>).buffer)
  }
  throw new Error('CapacitorHttp returned an unreadable binary body')
}

function toText(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export async function fetchYoutubeMedia(
  url: string,
  opts?: {
    binary?: boolean
    rangeStart?: number
    rangeEnd?: number
    extraHeaders?: Record<string, string>
  }
): Promise<{ status: number; data: ArrayBuffer | string; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    Referer: YOUTUBE_MEDIA_REFERER,
    Origin: YOUTUBE_MEDIA_ORIGIN,
    'User-Agent': YOUTUBE_IOS_APP_UA,
    'Accept-Language': 'en-US,en;q=0.9',
    ...(opts?.extraHeaders || {}),
  }
  if (
    typeof opts?.rangeStart === 'number' &&
    Number.isFinite(opts.rangeStart) &&
    opts.rangeStart >= 0
  ) {
    const start = Math.floor(opts.rangeStart)
    const end =
      typeof opts.rangeEnd === 'number' && Number.isFinite(opts.rangeEnd) && opts.rangeEnd > start
        ? Math.floor(opts.rangeEnd - 1)
        : undefined
    headers.Range = end != null ? `bytes=${start}-${end}` : `bytes=${start}-`
  }

  const res = await CapacitorHttp.request({
    url,
    method: 'GET',
    headers,
    responseType: opts?.binary ? 'arraybuffer' : 'text',
    connectTimeout: 15_000,
    readTimeout: 30_000,
  })

  const status = typeof res.status === 'number' && res.status > 0 ? res.status : 200
  const responseHeaders = (res.headers as Record<string, string>) || {}
  const data = opts?.binary ? toArrayBuffer(res.data) : toText(res.data)
  return { status, data, headers: responseHeaders }
}

/**
 * hls.js `config.loader` constructor. Used only on Capacitor (see CleanPlayer).
 */
export class YoutubeNativeHlsLoader {
  public stats: LoaderStats
  public context: LoaderContext | null = null
  private generation = 0

  // hls.js constructs loaders with the player config.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: unknown) {
    this.stats = emptyStats()
  }

  destroy(): void {
    this.abort()
    this.context = null
  }

  abort(): void {
    this.generation += 1
    this.stats.aborted = true
  }

  load(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>
  ): void {
    this.stats = emptyStats()
    this.context = context
    const gen = this.generation
    this.stats.loading.start = performance.now()

    const binary = wantsBinary(context.responseType)
    void fetchYoutubeMedia(context.url, {
      binary,
      rangeStart: context.rangeStart,
      rangeEnd: context.rangeEnd,
      extraHeaders: context.headers,
    })
      .then((res) => {
        if (gen !== this.generation || this.stats.aborted) return
        if (res.status < 200 || res.status >= 400) {
          const err = new Error(`YouTube HLS HTTP ${res.status}`) as Error & { code?: number }
          err.code = res.status
          callbacks.onError({ code: res.status, text: err.message }, context, null, this.stats)
          return
        }
        const now = performance.now()
        this.stats.loading.first = this.stats.loading.first || now
        this.stats.loading.end = now
        const byteLength =
          typeof res.data === 'string' ? res.data.length : res.data.byteLength
        this.stats.loaded = byteLength
        this.stats.total = byteLength
        this.stats.chunkCount = 1
        callbacks.onSuccess(
          {
            url: context.url,
            data: res.data,
            code: res.status,
          },
          this.stats,
          context,
          null
        )
      })
      .catch((err: unknown) => {
        if (gen !== this.generation || this.stats.aborted) return
        const message = err instanceof Error ? err.message : 'YouTube HLS fetch failed'
        callbacks.onError({ code: 0, text: message }, context, null, this.stats)
      })
  }
}
