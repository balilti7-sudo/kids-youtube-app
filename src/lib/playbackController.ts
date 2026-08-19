/** Global pause hooks — any active player registers here. */
const pauseHandlers = new Set<() => void>()

export function registerPlaybackPauseHandler(handler: () => void): () => void {
  pauseHandlers.add(handler)
  return () => {
    pauseHandlers.delete(handler)
  }
}

export function pauseAllPlayback(): void {
  for (const handler of pauseHandlers) {
    try {
      handler()
    } catch (err) {
      console.warn('[playbackController] pause handler failed', err)
    }
  }
}

if (typeof window !== 'undefined') {
  ;(window as unknown as { __safetubePauseAllPlayback?: () => void }).__safetubePauseAllPlayback =
    pauseAllPlayback
}
