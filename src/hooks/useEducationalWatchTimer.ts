import { useCallback, useEffect, useRef, useState } from 'react'
import type { InterceptPendingVideo } from '../lib/educationalIntercept'
import {
  breakThresholdSeconds,
  isInPreBreakCountdownWindow,
  secondsUntilBreak,
} from '../lib/educationalBreakTiming'
import type { EducationalBreakIntervalMinutes } from '../types'

type Options = {
  enabled: boolean
  playing: boolean
  intervalMinutes: EducationalBreakIntervalMinutes
  /** Authoritative watch seconds from server/runtime (updated on sync). */
  baseWatchSeconds: number
  getPendingVideo: () => InterceptPendingVideo | null
  onThresholdReached: (pending: InterceptPendingVideo) => void
  syncWatchSeconds?: (deltaSeconds: number) => Promise<number | void>
}

const SYNC_INTERVAL_MS = 10_000

export function useEducationalWatchTimer({
  enabled,
  playing,
  intervalMinutes,
  baseWatchSeconds,
  getPendingVideo,
  onThresholdReached,
  syncWatchSeconds,
}: Options) {
  const watchRef = useRef(Math.max(0, baseWatchSeconds))
  const pendingSyncRef = useRef(0)
  const onThresholdRef = useRef(onThresholdReached)
  const getPendingRef = useRef(getPendingVideo)
  const syncRef = useRef(syncWatchSeconds)

  const [watchSeconds, setWatchSeconds] = useState(() => Math.max(0, baseWatchSeconds))
  const [thresholdReached, setThresholdReached] = useState(
    () => Math.max(0, baseWatchSeconds) >= breakThresholdSeconds(intervalMinutes)
  )

  onThresholdRef.current = onThresholdReached
  getPendingRef.current = getPendingVideo
  syncRef.current = syncWatchSeconds

  const thresholdSeconds = breakThresholdSeconds(intervalMinutes)

  const applyServerWatchSeconds = useCallback(
    (serverSeconds: number) => {
      const next = Math.max(0, Math.floor(serverSeconds))
      watchRef.current = next
      setWatchSeconds(next)
      if (next >= thresholdSeconds) {
        setThresholdReached(true)
      }
    },
    [thresholdSeconds]
  )

  useEffect(() => {
    const reached = Math.max(0, baseWatchSeconds) >= thresholdSeconds
    setThresholdReached(reached)
    applyServerWatchSeconds(baseWatchSeconds)
  }, [baseWatchSeconds, thresholdSeconds, applyServerWatchSeconds])

  useEffect(() => {
    if (!enabled) {
      pendingSyncRef.current = 0
      return
    }

    if (!playing) {
      const delta = pendingSyncRef.current
      if (delta > 0 && syncRef.current) {
        pendingSyncRef.current = 0
        void syncRef.current(delta).then((serverSeconds) => {
          if (typeof serverSeconds === 'number') applyServerWatchSeconds(serverSeconds)
        })
      }
      return
    }

    const tickId = window.setInterval(() => {
      const next = watchRef.current + 1
      watchRef.current = next
      pendingSyncRef.current += 1
      setWatchSeconds(next)

      if (!thresholdReached && next >= thresholdSeconds) {
        setThresholdReached(true)
        const pending = getPendingRef.current()
        if (pending) onThresholdRef.current(pending)
      }
    }, 1000)

    const syncId = window.setInterval(() => {
      const delta = pendingSyncRef.current
      if (delta <= 0 || !syncRef.current) return
      pendingSyncRef.current = 0
      void syncRef.current(delta).then((serverSeconds) => {
        if (typeof serverSeconds === 'number') applyServerWatchSeconds(serverSeconds)
      })
    }, SYNC_INTERVAL_MS)

    return () => {
      window.clearInterval(tickId)
      window.clearInterval(syncId)
    }
  }, [enabled, playing, thresholdSeconds, thresholdReached, applyServerWatchSeconds])

  const remaining = secondsUntilBreak(watchSeconds, intervalMinutes)
  const showPreBreakCountdown =
    enabled && !thresholdReached && isInPreBreakCountdownWindow(watchSeconds, intervalMinutes)

  return {
    watchSeconds,
    secondsUntilBreak: remaining,
    showPreBreakCountdown,
    thresholdSeconds,
  }
}
