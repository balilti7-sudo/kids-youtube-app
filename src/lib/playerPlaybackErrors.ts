import { ChildPlaybackBlockedError } from './childRuntime'
import { streamErrorLooksLikeUpcomingLive, streamApiErrorIsUpcomingLive } from './liveStreamPolicy'
import { StreamApiError } from './streamApi'

/** Kid-friendly copy — never show raw yt-dlp / API errors in the UI. */
export const GENERIC_PLAYBACK_ERROR_MESSAGE =
  "Oops, this video had a little problem. Let's find something else to watch!"

export type PlaybackFailurePhase = 'upcoming_live' | 'error'

export type PlaybackFailureResult = {
  phase: PlaybackFailurePhase
  /** Logged to console only — not shown to children. */
  debugMessage: string
  retryable: boolean
}

function debugMessageFromUnknown(err: unknown): string {
  if (err instanceof StreamApiError) {
    return err.detail ?? err.message
  }
  if (err instanceof Error) return err.message
  return String(err ?? 'unknown playback error')
}

/**
 * Maps stream / bridge / media failures to a small set of player phases.
 * Only `upcoming_live` gets special UI; everything else uses the generic lion overlay.
 */
export function classifyPlaybackFailure(err: unknown): PlaybackFailureResult {
  if (err instanceof StreamApiError && streamApiErrorIsUpcomingLive(err)) {
    return {
      phase: 'upcoming_live',
      debugMessage: debugMessageFromUnknown(err),
      retryable: false,
    }
  }

  const msg = debugMessageFromUnknown(err)
  if (streamErrorLooksLikeUpcomingLive(msg)) {
    return { phase: 'upcoming_live', debugMessage: msg, retryable: false }
  }

  const retryable =
    err instanceof ChildPlaybackBlockedError
      ? false
      : err instanceof StreamApiError
        ? err.status == null || err.status >= 500 || err.status === 429
        : /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|Timeout/i.test(msg)

  return {
    phase: 'error',
    debugMessage: msg,
    retryable,
  }
}

export function logPlaybackFailure(context: string, result: PlaybackFailureResult, err?: unknown): void {
  console.error(`[CleanPlayer] ${context}`, result.debugMessage, err ?? '')
}
