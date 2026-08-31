import { useEffect, useRef } from 'react'

/** Extra time after catalog duration before auto-advancing (outro / embed lag). */
export const QUEUE_AUTO_ADVANCE_BUFFER_MS = 2_500
export const QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC = 4

/**
 * Schedule queue auto-advance when playback should be finished.
 * Used by Android iframe (no reliable `ended` event without IFrame API).
 */
export function useQueueAutoAdvanceTimer(options: {
  enabled: boolean
  durationSeconds?: number | null
  loopEnabled: boolean
  resetKey: string
  onAdvance: () => void
  /** When false, timer waits (e.g. iframe still loading). */
  playbackStarted?: boolean
}) {
  const {
    enabled,
    durationSeconds,
    loopEnabled,
    resetKey,
    onAdvance,
    playbackStarted = true,
  } = options

  const onAdvanceRef = useRef(onAdvance)
  onAdvanceRef.current = onAdvance

  useEffect(() => {
    if (!enabled || !playbackStarted || loopEnabled) return

    const sec = Number(durationSeconds)
    if (!Number.isFinite(sec) || sec < QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC) return

    const delayMs = Math.round(sec * 1000) + QUEUE_AUTO_ADVANCE_BUFFER_MS
    const timer = window.setTimeout(() => {
      onAdvanceRef.current()
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [enabled, durationSeconds, loopEnabled, resetKey, playbackStarted])
}
