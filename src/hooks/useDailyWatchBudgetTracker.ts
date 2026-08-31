import { useEffect } from 'react'
import { DAILY_WATCH_BUDGET_ENABLED } from '../lib/dailyWatchBudget'
import { useDailyWatchBudgetStore } from '../stores/dailyWatchBudgetStore'

/**
 * Tracks cumulative video playback time for the active child device and syncs to Supabase.
 * Currently disabled — daily limit is fully off; never blocks playback.
 */
export function useDailyWatchBudgetTracker(deviceId: string | null | undefined): {
  isLimitReached: boolean
} {
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)
  const resetForDevice = useDailyWatchBudgetStore((s) => s.resetForDevice)

  useEffect(() => {
    // Clear any prior lockout state when the feature is off.
    resetForDevice(deviceId)
    if (!DAILY_WATCH_BUDGET_ENABLED) {
      useDailyWatchBudgetStore.setState({
        watchSecondsToday: 0,
        dailyTimeLimitMinutes: 0,
        snoozeBonusSeconds: 0,
        isLimitReached: false,
      })
    }
  }, [deviceId, resetForDevice])

  if (!DAILY_WATCH_BUDGET_ENABLED) {
    return { isLimitReached: false }
  }

  // Feature re-enable path lives in git history / can be restored later.
  return { isLimitReached }
}
