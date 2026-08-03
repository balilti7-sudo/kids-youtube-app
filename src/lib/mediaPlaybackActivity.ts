import { startNativeMediaPlayback, stopNativeMediaPlayback } from './nativeMediaPlayback'

/**
 * Content is actually playing (video not paused). Used for daily watch budget + idle lock.
 * Separated from the Android foreground-service keep-alive so a paused/backgrounded
 * element does not keep burning the daily minute budget.
 */
let contentPlaying = false
/** Native FGS should stay up (may be true briefly while we try to resume after background pause). */
let nativeServiceDesired = false
let lastMeta: { title?: string; artist?: string } | undefined

export function isMediaPlaybackActive(): boolean {
  return contentPlaying
}

export type SetMediaPlaybackOptions = {
  /**
   * Keep the Android foreground service running even though content is not playing.
   * Used only for brief background-resume attempts — does NOT count toward watch budget.
   */
  maintainNativeService?: boolean
}

export function setMediaPlaybackActive(
  playing: boolean,
  meta?: { title?: string; artist?: string },
  options?: SetMediaPlaybackOptions
): void {
  if (meta) lastMeta = meta
  contentPlaying = playing

  if (playing) {
    nativeServiceDesired = true
    void startNativeMediaPlayback(meta ?? lastMeta)
    return
  }

  if (options?.maintainNativeService) {
    nativeServiceDesired = true
    void startNativeMediaPlayback(meta ?? lastMeta)
    return
  }

  if (nativeServiceDesired) {
    nativeServiceDesired = false
    void stopNativeMediaPlayback()
  }
}
