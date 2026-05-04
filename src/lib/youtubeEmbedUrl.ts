/**
 * YouTube IFrame embed URL with parameters that reduce branding and related-video leakage.
 *
 * - `modestbranding=1` — less YouTube logo chrome in the control bar (limited; Google may still show branding).
 * - `rel=0` — related videos are limited to the same channel (per current embed behavior).
 * - `iv_load_policy=3` — video annotations are not shown by default.
 * - `playsinline=1` — inline playback on mobile.
 * - `enablejsapi=0` — no JS API (we are not driving the player from JS).
 *
 * Note: `CleanPlayer` normally uses the Media Bridge + native `<video>` (no iframe), so these
 * params apply only when you render this URL in an `<iframe>` (see `VITE_YOUTUBE_IFRAME_PLAYER`).
 */
export function sanitizeYoutubeVideoId(raw: string): string | null {
  const id = raw.trim()
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null
  return id
}

export function buildYoutubePrivacyEmbedUrl(videoId: string, opts?: { origin?: string }): string {
  const id = sanitizeYoutubeVideoId(videoId)
  if (!id) return ''

  const params = new URLSearchParams({
    modestbranding: '1',
    rel: '0',
    iv_load_policy: '3',
    playsinline: '1',
    enablejsapi: '0',
  })

  const origin = opts?.origin?.trim()
  if (origin) {
    params.set('origin', origin)
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`
}
