/** True while a CleanPlayer video is playing (parent idle-lock is suppressed). */
let playbackActive = false

export function isMediaPlaybackActive(): boolean {
  return playbackActive
}

export function setMediaPlaybackActive(active: boolean): void {
  playbackActive = active
}
