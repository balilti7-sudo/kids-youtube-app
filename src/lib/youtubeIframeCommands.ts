/**
 * Lightweight YouTube embed postMessage commands (no YT.Player / IFrame API script).
 * Requires `enablejsapi=1` on the embed URL.
 */
export function postYoutubeIframeCommand(
  iframe: HTMLIFrameElement | null | undefined,
  func: string,
  args: Array<string | number | boolean> = []
): void {
  if (!iframe?.contentWindow) return
  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*'
    )
  } catch {
    /* cross-origin / not ready */
  }
}

export function youtubeIframePlay(iframe: HTMLIFrameElement | null | undefined): void {
  postYoutubeIframeCommand(iframe, 'playVideo')
}

export function youtubeIframePause(iframe: HTMLIFrameElement | null | undefined): void {
  postYoutubeIframeCommand(iframe, 'pauseVideo')
}

export function youtubeIframeMute(iframe: HTMLIFrameElement | null | undefined): void {
  postYoutubeIframeCommand(iframe, 'mute')
}

export function youtubeIframeUnmute(iframe: HTMLIFrameElement | null | undefined): void {
  postYoutubeIframeCommand(iframe, 'unMute')
}

/** Volume 0–100 for the YouTube embed. */
export function youtubeIframeSetVolume(
  iframe: HTMLIFrameElement | null | undefined,
  volume0to100: number
): void {
  const v = Math.max(0, Math.min(100, Math.round(volume0to100)))
  postYoutubeIframeCommand(iframe, 'setVolume', [v])
}

/** Seek to absolute position (seconds). */
export function youtubeIframeSeekTo(
  iframe: HTMLIFrameElement | null | undefined,
  seconds: number
): void {
  if (!Number.isFinite(seconds) || seconds < 0) return
  postYoutubeIframeCommand(iframe, 'seekTo', [seconds, true])
}
