import { useEffect, type ReactNode } from 'react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { isBedtimeRoutineVisible } from '../../lib/childRuntime'
import { getBedtimeRoutinePhase } from '../../lib/bedtimeRoutinePhase'
import { useBedtimeGraceCountdown } from '../../hooks/useBedtimeRoutineCountdown'
import { useBedtimeRoutineStore } from '../../stores/bedtimeRoutineStore'
import { BedtimeRoutineCountdownBanner } from './BedtimeRoutineCountdownBanner'
import { BedtimeRoutinePassiveWait } from './BedtimeRoutinePassiveWait'
import { BedtimeRoutineView } from './BedtimeRoutineView'

type Props = {
  children: ReactNode
  deviceId: string | null
}

/**
 * Bedtime flow (parent-controlled):
 * 1. passive — "time for sleep", watching allowed, no timer
 * 2. countdown — after parent PIN starts grace (server timestamp)
 * 3. routine — full-screen tasks / wheel
 */
export function BedtimeRoutineGate({ children, deviceId }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const ready = runtime?.ready ?? false

  const hydrateForDevice = useBedtimeRoutineStore((s) => s.hydrateForDevice)
  const resetForDevice = useBedtimeRoutineStore((s) => s.resetForDevice)
  const clearDismissedRoutineDate = useBedtimeRoutineStore((s) => s.clearDismissedRoutineDate)
  const isRoutineDismissedForDate = useBedtimeRoutineStore((s) => s.isRoutineDismissedForDate)
  const dismissed = isRoutineDismissedForDate(bedtime?.routineDate)

  // Re-render each second during parent-started grace so phase can flip to full routine.
  useBedtimeGraceCountdown(bedtime)

  useEffect(() => {
    hydrateForDevice(deviceId)
  }, [deviceId, hydrateForDevice])

  useEffect(() => {
    if (!ready || !deviceId || !bedtime) return

    if (!isBedtimeRoutineVisible(bedtime) || bedtime.wheelSpun) {
      clearDismissedRoutineDate()
      resetForDevice()
    }
  }, [ready, deviceId, bedtime, clearDismissedRoutineDate, resetForDevice])

  const phase = getBedtimeRoutinePhase(bedtime, { dismissedForTonight: dismissed })

  if (phase === 'routine') {
    return <BedtimeRoutineView />
  }

  return (
    <>
      {phase === 'passive' ? <BedtimeRoutinePassiveWait /> : null}
      {phase === 'countdown' ? (
        <div className="sticky top-0 z-[60] px-3 pt-2 sm:px-4">
          <BedtimeRoutineCountdownBanner />
        </div>
      ) : null}
      {children}
    </>
  )
}
