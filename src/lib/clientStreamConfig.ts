/**
 * Client-side YouTube stream resolution (Innertube from the user's browser).
 * Avoids datacenter yt-dlp / proxy bot blocks — the user's residential IP does the extract.
 *
 * Enable in production: VITE_CLIENT_STREAM_RESOLVE=true
 * Bridge must set USE_CLIENT_STREAM_RESOLVE=1 (disables server yt-dlp worker path).
 */
export function isClientStreamResolveEnabled(): boolean {
  const flag = String(import.meta.env.VITE_CLIENT_STREAM_RESOLVE ?? '').trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  // Local dev: default on so the bridge worker is not required for playback tests.
  if (import.meta.env.DEV && flag !== '0' && flag !== 'false') return true
  return false
}

/** Referer sent by the bridge media proxy when fetching googlevideo URLs. */
export const YOUTUBE_STREAM_REFERER = 'https://www.youtube.com/'
