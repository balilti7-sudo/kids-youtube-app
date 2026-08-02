import { startNativeMediaPlayback, stopNativeMediaPlayback } from './nativeMediaPlayback'

/** True while a CleanPlayer video is playing (parent idle-lock is suppressed). */
let playbackActive = false

export function isMediaPlaybackActive(): boolean {
  return playbackActive
}

export function setMediaPlaybackActive(active: boolean, meta?: { title?: string; artist?: string }): void {
  const wasActive = playbackActive
  playbackActive = active
  if (active && !wasActive) {
    void startNativeMediaPlayback(meta)
  } else if (!active && wasActive) {
    void stopNativeMediaPlayback()
  }
}
