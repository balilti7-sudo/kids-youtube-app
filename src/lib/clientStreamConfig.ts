/**
 * Client-side YouTube stream resolution (Innertube from the user's browser).
 * Avoids datacenter yt-dlp / proxy bot blocks — the user's residential IP does the extract.
 *
 * Enable in production: VITE_CLIENT_STREAM_RESOLVE=true
 * Bridge must set USE_CLIENT_STREAM_RESOLVE=1 (disables server yt-dlp worker path).
 */
export function isClientStreamResolveEnabled(): boolean {
  const flag = String(import.meta.env.VITE_CLIENT_STREAM_RESOLVE ?? '').trim().toLowerCase()
  if (flag === '0' || flag === 'false') return false
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  // Production default: server Bunny/yt-dlp path is removed; browser resolves via InnerTube.
  if (import.meta.env.PROD) return true
  // Local dev: default on unless explicitly disabled.
  if (import.meta.env.DEV) return true
  return false
}

/** Referer sent by the bridge media proxy when fetching googlevideo URLs. */
export const YOUTUBE_STREAM_REFERER = 'https://www.youtube.com/'
