import type { ContentShape } from './videoFormatClassification'

/**
 * Imperative session bridge so frozen CleanPlayer can read the authoritative
 * content shape without DOM inspection. Synced by PlayerModeProvider / watch shell.
 */
let activeContentShape: ContentShape = 'long'

export function setPlaybackContentShape(shape: ContentShape): void {
  activeContentShape = shape
}

export function getPlaybackContentShape(): ContentShape {
  return activeContentShape
}

export function resetPlaybackContentShape(): void {
  activeContentShape = 'long'
}
