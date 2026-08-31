/**
 * Lightweight watch/Shorts navigation helpers (history + restore context).
 * Does not own playback — pages keep CleanPlayer / KidShortsLane as-is.
 */

export const SAFETUBE_PLAYER_HISTORY_KEY = 'safetubePlayerLayer'

export type SafetubePlayerHistoryLayer = 'watch' | 'shorts'

/** Snapshot of browse UI captured once when entering Watch or Shorts. */
export type BrowseNavContext = {
  channelContentTab: string
  scrollY: number
  /** Video that was active before the session (usually null when entering from browse). */
  priorActiveVideoId: string | null
  watchStarted?: boolean
}

export function readPlayerHistoryLayer(state: unknown): SafetubePlayerHistoryLayer | null {
  if (!state || typeof state !== 'object') return null
  const layer = (state as Record<string, unknown>)[SAFETUBE_PLAYER_HISTORY_KEY]
  if (layer === 'watch' || layer === 'shorts') return layer
  return null
}

function nextHistoryState(layer: SafetubePlayerHistoryLayer): Record<string, unknown> {
  const base =
    typeof history.state === 'object' && history.state !== null
      ? { ...(history.state as Record<string, unknown>) }
      : {}
  base[SAFETUBE_PLAYER_HISTORY_KEY] = layer
  return base
}

/**
 * Ensure exactly one player-owned history entry for the session.
 * Short swipes / expand / fullscreen must NOT call this repeatedly with new entries —
 * same layer is a no-op; watch→shorts replaces in place.
 */
export function ensurePlayerHistoryLayer(layer: SafetubePlayerHistoryLayer): void {
  if (typeof history === 'undefined') return
  const current = readPlayerHistoryLayer(history.state)
  if (current === layer) return
  const state = nextHistoryState(layer)
  if (current == null) history.pushState(state, '')
  else history.replaceState(state, '')
}

/**
 * Drop our history entry after a UI-initiated exit (X / swipe-down / in-app back).
 * Caller must set a suppress flag so the matching popstate does not exit twice.
 */
export function popPlayerHistoryLayerIfPresent(): void {
  if (typeof history === 'undefined') return
  if (readPlayerHistoryLayer(history.state) == null) return
  history.back()
}

export function captureBrowseNavContext(input: {
  channelContentTab: string
  priorActiveVideoId: string | null
  watchStarted?: boolean
}): BrowseNavContext {
  return {
    channelContentTab: input.channelContentTab,
    scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
    priorActiveVideoId: input.priorActiveVideoId,
    watchStarted: input.watchStarted,
  }
}

export function restoreBrowseScroll(scrollY: number): void {
  if (typeof window === 'undefined') return
  const y = Math.max(0, scrollY)
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: y, behavior: 'auto' })
  })
}
