/**
 * Global parental limit switches.
 * When disabled, the app ignores Supabase + cached values so old server rows
 * cannot keep blocking playback after parent toggles settings in the dashboard.
 */
export const DAILY_WATCH_BUDGET_ENABLED = false
export const SHORTS_BLOCKING_ENABLED = false
export const SCREEN_TIME_BLOCKING_ENABLED = false

export function effectiveAllowShorts(_serverValue?: boolean | null): boolean {
  if (!SHORTS_BLOCKING_ENABLED) return true
  return Boolean(_serverValue)
}

export function effectiveDailyTimeLimitMinutes(_serverValue?: number | null): number {
  if (!DAILY_WATCH_BUDGET_ENABLED) return 0
  const n = Number(_serverValue ?? 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(1440, Math.round(n))
}

/** Strip stale lockout state from sessionStorage on boot. */
export function clearStaleParentalLimitCaches(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem('safetube_daily_watch_snooze_v1')
    if (!SCREEN_TIME_BLOCKING_ENABLED) {
      sessionStorage.removeItem('safetube_child_runtime_cache_v1')
    }
  } catch {
    /* ignore */
  }
}
