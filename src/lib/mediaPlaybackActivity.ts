import { startNativeMediaPlayback, stopNativeMediaPlayback } from './nativeMediaPlayback'

/** True while a CleanPlayer video is playing (parent idle-lock is suppressed). */
let playbackActive = false
let startTimer: ReturnType<typeof setTimeout> | null = null

export function isMediaPlaybackActive(): boolean {
  return playbackActive
}

export function setMediaPlaybackActive(active: boolean, meta?: { title?: string; artist?: string }): void {
  const wasActive = playbackActive
  playbackActive = active

  if (startTimer) {
    clearTimeout(startTimer)
    startTimer = null
  }

  if (active && !wasActive) {
    // Delay FGS slightly so initial <video>.play() / resolve are never blocked by
    // notification permission or foreground-service startup.
    startTimer = setTimeout(() => {
      startTimer = null
      if (playbackActive) void startNativeMediaPlayback(meta)
    }, 750)
  } else if (!active && wasActive) {
    void stopNativeMediaPlayback()
  }
}
