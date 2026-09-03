import type { PresentationShape } from './presentationShape'
import type { PlayerExpandMode } from './playerTheater'

/** Authoritative layout / chrome mode — independent of contentShape (Short vs long). */
export type PlayerMode =
  | 'inline'
  | 'theaterPortrait'
  | 'theaterLandscape'
  | 'mini'
  | 'shortsLane'

export function theaterModeForPresentation(
  presentation: PresentationShape
): 'theaterPortrait' | 'theaterLandscape' {
  return presentation === 'portrait' ? 'theaterPortrait' : 'theaterLandscape'
}

/**
 * Maps playerTheater expand axis (CSS/orientation seam: long | short) to geometry playerMode.
 * Not content classification — portrait theater uses internal expand mode `short`.
 */
export function playerModeFromTheaterExpandMode(expandMode: PlayerExpandMode | null): PlayerMode {
  if (expandMode === 'short') return 'theaterPortrait'
  if (expandMode === 'long') return 'theaterLandscape'
  return 'inline'
}

export function isTheaterPlayerMode(mode: PlayerMode): boolean {
  return mode === 'theaterPortrait' || mode === 'theaterLandscape'
}

export function modeBlocksStickyMini(mode: PlayerMode): boolean {
  return isTheaterPlayerMode(mode) || mode === 'shortsLane'
}

export function collapsedPlayerMode(miniActive: boolean): PlayerMode {
  return miniActive ? 'mini' : 'inline'
}
