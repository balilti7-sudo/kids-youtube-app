import { useEffect } from 'react'
import { useBedtimeRoutineStore } from '../stores/bedtimeRoutineStore'

/** Keeps countdownRemainingSeconds in sync and activates routine when it hits zero. */
export function useBedtimeRoutineCountdown() {
  const countdownEndsAt = useBedtimeRoutineStore((s) => s.countdownEndsAt)
  const isRoutineActive = useBedtimeRoutineStore((s) => s.isRoutineActive)
  const syncCountdownTick = useBedtimeRoutineStore((s) => s.syncCountdownTick)

  useEffect(() => {
    if (isRoutineActive || !countdownEndsAt) return
    syncCountdownTick()
    const id = window.setInterval(() => syncCountdownTick(), 1000)
    return () => window.clearInterval(id)
  }, [countdownEndsAt, isRoutineActive, syncCountdownTick])
}
