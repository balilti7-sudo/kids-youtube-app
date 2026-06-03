import { getSavedChildAccessToken } from './childDevice'
import { supabase } from './supabase'

export type DailyWatchState = {
  deviceId: string
  watchDate: string
  watchSecondsToday: number
  dailyTimeLimitMinutes: number
}

export type DailyWatchReportResult = {
  watchSecondsToday: number
  dailyTimeLimitMinutes: number
}

function mapDailyWatchStateRow(row: Record<string, unknown>): DailyWatchState {
  return {
    deviceId: String(row.device_id ?? row.deviceId ?? ''),
    watchDate: String(row.watch_date ?? row.watchDate ?? ''),
    watchSecondsToday: Number(row.watch_seconds_today ?? row.watchSecondsToday ?? 0),
    dailyTimeLimitMinutes: Number(row.daily_time_limit_minutes ?? row.dailyTimeLimitMinutes ?? 60),
  }
}

function mapDailyWatchReportRow(row: Record<string, unknown>): DailyWatchReportResult {
  return {
    watchSecondsToday: Number(row.watch_seconds_today ?? row.watchSecondsToday ?? 0),
    dailyTimeLimitMinutes: Number(row.daily_time_limit_minutes ?? row.dailyTimeLimitMinutes ?? 60),
  }
}

export async function fetchDailyWatchState(
  deviceId: string
): Promise<{ data: DailyWatchState | null; error: Error | null }> {
  const trimmedDeviceId = deviceId.trim()
  if (!trimmedDeviceId) {
    return { data: null, error: new Error('DEVICE_ID_REQUIRED') }
  }

  const token = getSavedChildAccessToken()
  if (token) {
    const { data, error } = await supabase.rpc('child_get_daily_watch_state', {
      p_access_token: token,
    })
    if (error) return { data: null, error: new Error(error.message) }
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return { data: null, error: null }
    return { data: mapDailyWatchStateRow(row as Record<string, unknown>), error: null }
  }

  const { data, error } = await supabase.rpc('owner_get_daily_watch_state', {
    p_device_id: trimmedDeviceId,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapDailyWatchStateRow(row as Record<string, unknown>), error: null }
}

export async function reportDailyWatchSeconds(
  deviceId: string,
  seconds: number
): Promise<{ data: DailyWatchReportResult | null; error: Error | null }> {
  const trimmedDeviceId = deviceId.trim()
  const add = Math.max(0, Math.floor(seconds))
  if (!trimmedDeviceId || add <= 0) {
    return { data: null, error: null }
  }

  const token = getSavedChildAccessToken()
  if (token) {
    const { data, error } = await supabase.rpc('child_report_watch_seconds', {
      p_access_token: token,
      p_seconds: add,
    })
    if (error) return { data: null, error: new Error(error.message) }
    const row = Array.isArray(data) ? data[0] : null
    if (!row) return { data: null, error: null }
    return { data: mapDailyWatchReportRow(row as Record<string, unknown>), error: null }
  }

  const { data, error } = await supabase.rpc('owner_report_watch_seconds', {
    p_device_id: trimmedDeviceId,
    p_seconds: add,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapDailyWatchReportRow(row as Record<string, unknown>), error: null }
}

export function isDailyWatchBudgetExceeded(
  watchSecondsToday: number,
  dailyTimeLimitMinutes: number,
  snoozeBonusSeconds = 0
): boolean {
  const limitSeconds = Math.max(1, dailyTimeLimitMinutes) * 60 + Math.max(0, snoozeBonusSeconds)
  return watchSecondsToday >= limitSeconds
}

export function logDailyWatchBudgetExceeded(state: DailyWatchState): void {
  console.warn('[DailyWatchBudget] daily viewing limit reached', {
    deviceId: state.deviceId,
    watchDate: state.watchDate,
    watchSecondsToday: state.watchSecondsToday,
    dailyTimeLimitMinutes: state.dailyTimeLimitMinutes,
    watchMinutesToday: Math.round(state.watchSecondsToday / 60),
  })
}
