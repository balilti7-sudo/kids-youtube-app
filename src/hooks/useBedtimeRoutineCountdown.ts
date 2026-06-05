import { useEffect, useState } from 'react'
import { getGraceCountdownRemainingSeconds } from '../lib/bedtimeRoutinePhase'
import type { ChildBedtimeState } from '../lib/childRuntime'

/** Ticks grace countdown UI while parent-started grace is active. */
export function useBedtimeGraceCountdown(bedtime: ChildBedtimeState | null | undefined) {
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getGraceCountdownRemainingSeconds(bedtime)
  )

  useEffect(() => {
    if (!bedtime?.graceCountdownStartedAt) {
      setRemainingSeconds(0)
      return
    }

    const tick = () => setRemainingSeconds(getGraceCountdownRemainingSeconds(bedtime))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [bedtime?.graceCountdownStartedAt, bedtime?.gracePeriodMinutes, bedtime])

  return remainingSeconds
}

/** @deprecated Use useBedtimeGraceCountdown */
export function useBedtimeRoutineCountdown() {
  return 0
}
