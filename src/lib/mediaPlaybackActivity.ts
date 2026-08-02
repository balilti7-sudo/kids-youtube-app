import { startNativeMediaPlayback, stopNativeMediaPlayback } from './nativeMediaPlayback'

/** True while a CleanPlayer video is playing (parent idle-lock is suppressed). */
let playbackActive = false
/** Last metadata — used to refresh the FGS notification without restarting. */
let lastMeta: { title?: string; artist?: string } | undefined

export function isMediaPlaybackActive(): boolean {
  return playbackActive
}

export function setMediaPlaybackActive(active: boolean, meta?: { title?: string; artist?: string }): void {
  const wasActive = playbackActive
  if (meta) lastMeta = meta
  playbackActive = active

  if (active) {
    // Start immediately so backgrounding right after play still has an FGS.
    void startNativeMediaPlayback(meta ?? lastMeta)
  } else if (wasActive) {
    void stopNativeMediaPlayback()
  }
}
