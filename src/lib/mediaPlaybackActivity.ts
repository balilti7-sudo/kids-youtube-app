import {
  startNativeMediaPlayback,
  stopNativeMediaPlayback,
  updateNativeMediaSession,
  type NativeMediaSessionUpdate,
} from './nativeMediaPlayback'

/**
 * Content is actually playing (video not paused). Used for daily watch budget + idle lock.
 * Separated from the Android foreground-service keep-alive so a paused/backgrounded
 * element does not keep burning the daily minute budget.
 */
let contentPlaying = false
/** Native FGS should stay up (may be true briefly while we try to resume after background pause). */
let nativeServiceDesired = false
let lastMeta: NativeMediaSessionUpdate = {
  title: 'SafeTube',
  artist: 'מתנגן עכשיו',
  canSkipNext: true,
  canSkipPrev: true,
  playing: false,
}

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

function mergeMeta(meta?: NativeMediaSessionUpdate): NativeMediaSessionUpdate {
  if (!meta) return { ...lastMeta }
  lastMeta = {
    ...lastMeta,
    ...meta,
    title: meta.title ?? lastMeta.title,
    artist: meta.artist ?? lastMeta.artist,
  }
  return { ...lastMeta }
}

export function setMediaPlaybackActive(
  playing: boolean,
  meta?: NativeMediaSessionUpdate,
  options?: SetMediaPlaybackOptions
): void {
  const merged = mergeMeta({ ...meta, playing })
  contentPlaying = playing

  if (playing) {
    nativeServiceDesired = true
    void startNativeMediaPlayback(merged)
    return
  }

  if (options?.maintainNativeService) {
    nativeServiceDesired = true
    void startNativeMediaPlayback({ ...merged, playing: false })
    return
  }

  if (nativeServiceDesired) {
    nativeServiceDesired = false
    void stopNativeMediaPlayback()
  }
}

/** Push live duration / position / artwork into the Android MediaSession (throttled by caller). */
export function syncNativeMediaSession(meta: NativeMediaSessionUpdate): void {
  const merged = mergeMeta(meta)
  if (!nativeServiceDesired && !contentPlaying) return
  void updateNativeMediaSession(merged)
}
