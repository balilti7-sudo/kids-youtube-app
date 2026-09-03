import type { PresentationShape } from './presentationShape'

export const PLAYBACK_PRESENTATION_SHAPE_CHANGED = 'safetube-playback-presentation-shape-changed'

/**
 * Imperative session bridge for expand theater geometry.
 * Independent of contentShape (Short vs long product classification).
 */
let activePresentationShape: PresentationShape = 'landscape'

export function setPlaybackPresentationShape(shape: PresentationShape): void {
  if (shape === activePresentationShape) return
  activePresentationShape = shape
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PLAYBACK_PRESENTATION_SHAPE_CHANGED, { detail: shape })
    )
  }
}

export function getPlaybackPresentationShape(): PresentationShape {
  return activePresentationShape
}

export function resetPlaybackPresentationShape(): void {
  activePresentationShape = 'landscape'
}
