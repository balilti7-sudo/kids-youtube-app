/**
 * YouTube IFrame embed URL with parameters that reduce branding and related-video leakage.
 *
 * - `modestbranding=1` — less YouTube logo chrome in the control bar (limited; Google may still show branding).
 * - `rel=0` — related videos are limited to the same channel (per current embed behavior).
 * - `iv_load_policy=3` — video annotations are not shown by default.
 * - `playsinline=1` — inline playback on mobile.
 * - `enablejsapi=1` — postMessage play/pause/seek for car + under-bar controls.
 *   Never pair with Capacitor `origin=https://localhost` (that combination blacks the embed).
 * - `fs=0` — hide YouTube’s fullscreen control (Android WebView often traps users with no exit).
 * - `disablekb=1` — reduce keyboard shortcuts leaking out of the embed.
 *
 * Android uses `www.youtube.com` + `widget_referrer` (WebView embed contract).
 * Web iframe opt-in uses `youtube-nocookie.com`.
 */
export function sanitizeYoutubeVideoId(raw: string): string | null {
  const id = raw.trim()
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return null
  return id
}

export function buildYoutubePrivacyEmbedUrl(
  videoId: string,
  opts?: { origin?: string; autoplay?: boolean; host?: 'nocookie' | 'youtube' }
): string {
  const id = sanitizeYoutubeVideoId(videoId)
  if (!id) return ''

  const params = new URLSearchParams({
    modestbranding: '1',
    rel: '0',
    iv_load_policy: '3',
    playsinline: '1',
    enablejsapi: '1',
    fs: '0',
    disablekb: '1',
  })

  // Autoplay for instant playback the moment the player mounts on tap.
  if (opts?.autoplay) {
    params.set('autoplay', '1')
    params.set('mute', '0')
  }

  // Capacitor WebView origin (https://localhost) + enablejsapi blacks the player.
  // Only forward real https origins (e.g. production web).
  const origin = opts?.origin?.trim()
  if (origin && /^https:\/\//i.test(origin) && !/localhost|127\.0\.0\.1|capacitor/i.test(origin)) {
    params.set('origin', origin)
  }

  params.set('widget_referrer', 'https://www.youtube.com/')

  const host = opts?.host === 'youtube' ? 'www.youtube.com' : 'www.youtube-nocookie.com'
  return `https://${host}/embed/${encodeURIComponent(id)}?${params.toString()}`
}
