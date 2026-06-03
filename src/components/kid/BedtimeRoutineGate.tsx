import { useEffect, type ReactNode } from 'react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { isBedtimeRoutineVisible } from '../../lib/childRuntime'
import { useBedtimeRoutineCountdown } from '../../hooks/useBedtimeRoutineCountdown'
import {
  BEDTIME_ROUTINE_COUNTDOWN_MINUTES,
  useBedtimeRoutineStore,
} from '../../stores/bedtimeRoutineStore'
import { BedtimeRoutineCountdownBanner } from './BedtimeRoutineCountdownBanner'
import { BedtimeRoutineView } from './BedtimeRoutineView'

type Props = {
  children: ReactNode
  /** Active child device id for this page. */
  deviceId: string | null
}

/**
 * When bedtime is enabled: starts a 5-minute countdown, then switches to full Routine View
 * (hiding channels / video). Clears when tonight's wheel has been spun.
 */
export function BedtimeRoutineGate({ children, deviceId }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const ready = runtime?.ready ?? false

  const isRoutineActive = useBedtimeRoutineStore((s) => s.isRoutineActive)
  const countdownEndsAt = useBedtimeRoutineStore((s) => s.countdownEndsAt)
  const hydrateForDevice = useBedtimeRoutineStore((s) => s.hydrateForDevice)
  const startCountdown = useBedtimeRoutineStore((s) => s.startCountdown)
  const deactivateRoutine = useBedtimeRoutineStore((s) => s.deactivateRoutine)

  useBedtimeRoutineCountdown()

  useEffect(() => {
    hydrateForDevice(deviceId)
  }, [deviceId, hydrateForDevice])

  useEffect(() => {
    if (!ready || !deviceId || !bedtime) return

    if (!isBedtimeRoutineVisible(bedtime)) {
      deactivateRoutine()
      return
    }

    if (bedtime.wheelSpun) {
      deactivateRoutine()
      return
    }

    const store = useBedtimeRoutineStore.getState()
    if (store.isRoutineActive) return
    if (store.countdownEndsAt && store.countdownEndsAt > Date.now()) return

    startCountdown(deviceId, BEDTIME_ROUTINE_COUNTDOWN_MINUTES)
  }, [ready, deviceId, bedtime, deactivateRoutine, startCountdown])

  if (isRoutineActive) {
    return <BedtimeRoutineView />
  }

  const showCountdownBanner = Boolean(countdownEndsAt) && !isRoutineActive

  return (
    <>
      {showCountdownBanner ? (
        <div className="sticky top-0 z-[60] px-3 pt-2 sm:px-4">
          <BedtimeRoutineCountdownBanner />
        </div>
      ) : null}
      {children}
    </>
  )
}
