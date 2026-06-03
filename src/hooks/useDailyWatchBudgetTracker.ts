import { useEffect, useRef } from 'react'
import {
  fetchDailyWatchState,
  logDailyWatchBudgetExceeded,
  reportDailyWatchSeconds,
  type DailyWatchState,
} from '../lib/dailyWatchBudget'
import { isMediaPlaybackActive } from '../lib/mediaPlaybackActivity'
import { useDailyWatchBudgetStore } from '../stores/dailyWatchBudgetStore'

const FLUSH_EVERY_SECONDS = 15

/**
 * Tracks cumulative video playback time for the active child device and syncs to Supabase.
 * Exposes `isLimitReached` for player overlays and playback guards.
 */
export function useDailyWatchBudgetTracker(deviceId: string | null | undefined): {
  isLimitReached: boolean
} {
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)
  const resetForDevice = useDailyWatchBudgetStore((s) => s.resetForDevice)
  const applyWatchState = useDailyWatchBudgetStore((s) => s.applyWatchState)
  const incrementLocalWatchSeconds = useDailyWatchBudgetStore((s) => s.incrementLocalWatchSeconds)
  const applyServerTotals = useDailyWatchBudgetStore((s) => s.applyServerTotals)

  const pendingSecondsRef = useRef(0)
  const stateRef = useRef<DailyWatchState | null>(null)
  const exceededLoggedRef = useRef(false)
  const flushingRef = useRef(false)

  const maybeLogExceeded = () => {
    const state = stateRef.current
    if (!state || exceededLoggedRef.current) return
    if (!useDailyWatchBudgetStore.getState().isLimitReached) return
    exceededLoggedRef.current = true
    logDailyWatchBudgetExceeded(state)
  }

  const syncServerTotals = (watchSecondsToday: number, dailyTimeLimitMinutes: number) => {
    const prev = stateRef.current
    if (!prev) return
    stateRef.current = {
      ...prev,
      watchSecondsToday,
      dailyTimeLimitMinutes,
    }
    applyServerTotals(watchSecondsToday, dailyTimeLimitMinutes)
    maybeLogExceeded()
  }

  const flushPending = async (id: string) => {
    const pending = pendingSecondsRef.current
    if (pending <= 0 || flushingRef.current) return
    pendingSecondsRef.current = 0
    flushingRef.current = true
    try {
      const { data, error } = await reportDailyWatchSeconds(id, pending)
      if (error) {
        pendingSecondsRef.current += pending
        console.warn('[DailyWatchBudget] sync failed', error.message)
        return
      }
      if (data) {
        syncServerTotals(data.watchSecondsToday, data.dailyTimeLimitMinutes)
      }
    } finally {
      flushingRef.current = false
    }
  }

  useEffect(() => {
    exceededLoggedRef.current = false
    pendingSecondsRef.current = 0
    stateRef.current = null
    resetForDevice(deviceId)

    const id = deviceId?.trim()
    if (!id) return

    let cancelled = false
    void fetchDailyWatchState(id).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.warn('[DailyWatchBudget] initial load failed', error.message)
        return
      }
      if (!data) return
      stateRef.current = data
      applyWatchState(data)
      maybeLogExceeded()
    })

    return () => {
      cancelled = true
    }
  }, [deviceId, resetForDevice, applyWatchState])

  useEffect(() => {
    const id = deviceId?.trim()
    if (!id) return

    const tickId = window.setInterval(() => {
      if (!isMediaPlaybackActive()) return
      pendingSecondsRef.current += 1
      if (stateRef.current) {
        stateRef.current = {
          ...stateRef.current,
          watchSecondsToday: stateRef.current.watchSecondsToday + 1,
        }
        incrementLocalWatchSeconds(1)
        maybeLogExceeded()
      }
      if (pendingSecondsRef.current >= FLUSH_EVERY_SECONDS) {
        void flushPending(id)
      }
    }, 1000)

    const onHidden = () => {
      void flushPending(id)
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)

    return () => {
      window.clearInterval(tickId)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      void flushPending(id)
    }
  }, [deviceId, incrementLocalWatchSeconds, applyServerTotals])

  return { isLimitReached }
}
