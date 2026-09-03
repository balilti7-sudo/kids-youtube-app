import type { PlayerMode } from './playerMode'

export const PLAYBACK_PLAYER_MODE_CHANGED = 'safetube-playback-player-mode-changed'

/**
 * Imperative session bridge for authoritative playerMode outside React context
 * (gestures, back navigation, frozen player seams).
 */
let activePlayerMode: PlayerMode = 'inline'

export function setPlaybackPlayerMode(mode: PlayerMode): void {
  if (mode === activePlayerMode) return
  activePlayerMode = mode
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PLAYBACK_PLAYER_MODE_CHANGED, { detail: mode }))
  }
}

export function getPlaybackPlayerMode(): PlayerMode {
  return activePlayerMode
}

export function resetPlaybackPlayerMode(): void {
  activePlayerMode = 'inline'
}
