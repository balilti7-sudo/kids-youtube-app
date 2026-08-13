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

/** Push live duration / position / artwork into the Android MediaSession (throttled). */
let lastNativeSyncAt = 0
let lastNativeSyncKey = ''
let nativeSyncTimer: ReturnType<typeof setTimeout> | null = null
let pendingNativeSync: NativeMediaSessionUpdate | null = null

function flushNativeMediaSessionSync() {
  nativeSyncTimer = null
  const meta = pendingNativeSync
  pendingNativeSync = null
  if (!meta) return
  if (!nativeServiceDesired && !contentPlaying) return
  const merged = mergeMeta(meta)
  const key = [
    merged.title ?? '',
    merged.artist ?? '',
    merged.playing ? '1' : '0',
    merged.artworkUrl ?? '',
    merged.canSkipNext ? '1' : '0',
    merged.canSkipPrev ? '1' : '0',
    // Bucket position to ~2s so heartbeats do not thrash the bridge.
    String(Math.floor((merged.positionMs ?? 0) / 2000)),
    String(Math.floor((merged.durationMs ?? 0) / 1000)),
  ].join('|')
  const now = Date.now()
  if (key === lastNativeSyncKey && now - lastNativeSyncAt < 1800) return
  lastNativeSyncKey = key
  lastNativeSyncAt = now
  void updateNativeMediaSession(merged)
}

export function syncNativeMediaSession(meta: NativeMediaSessionUpdate): void {
  pendingNativeSync = { ...(pendingNativeSync ?? {}), ...meta }
  if (nativeSyncTimer != null) return
  // Coalesce rapid timeupdate-driven pushes onto one bridge call.
  nativeSyncTimer = setTimeout(flushNativeMediaSessionSync, 400)
}
