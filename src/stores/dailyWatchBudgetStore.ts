import { create } from 'zustand'
import {
  isDailyWatchBudgetExceeded,
  type DailyWatchState,
} from '../lib/dailyWatchBudget'

export const DAILY_WATCH_SNOOZE_MINUTES = 5
export const DAILY_WATCH_SNOOZE_SECONDS = DAILY_WATCH_SNOOZE_MINUTES * 60

const SNOOZE_STORAGE_KEY = 'safetube_daily_watch_snooze_v1'

type PersistedSnooze = {
  deviceId: string
  watchDate: string
  snoozeBonusSeconds: number
}

function readPersistedSnooze(deviceId: string, watchDate: string): number {
  try {
    const raw = sessionStorage.getItem(SNOOZE_STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as PersistedSnooze
    if (parsed.deviceId !== deviceId || parsed.watchDate !== watchDate) return 0
    return Math.max(0, Number(parsed.snoozeBonusSeconds) || 0)
  } catch {
    return 0
  }
}

function writePersistedSnooze(deviceId: string, watchDate: string, snoozeBonusSeconds: number) {
  try {
    sessionStorage.setItem(
      SNOOZE_STORAGE_KEY,
      JSON.stringify({ deviceId, watchDate, snoozeBonusSeconds })
    )
  } catch {
    /* ignore */
  }
}

function clearPersistedSnooze() {
  try {
    sessionStorage.removeItem(SNOOZE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function computeLimitReached(
  watchSecondsToday: number,
  dailyTimeLimitMinutes: number,
  snoozeBonusSeconds: number
): boolean {
  return isDailyWatchBudgetExceeded(watchSecondsToday, dailyTimeLimitMinutes, snoozeBonusSeconds)
}

export type DailyWatchBudgetStore = {
  deviceId: string | null
  watchDate: string | null
  watchSecondsToday: number
  dailyTimeLimitMinutes: number
  snoozeBonusSeconds: number
  isLimitReached: boolean
  resetForDevice: (deviceId: string | null | undefined) => void
  applyWatchState: (state: DailyWatchState) => void
  incrementLocalWatchSeconds: (delta?: number) => void
  applyServerTotals: (watchSecondsToday: number, dailyTimeLimitMinutes: number) => void
  snoozeMinutes: (minutes?: number) => void
}

export const useDailyWatchBudgetStore = create<DailyWatchBudgetStore>((set, get) => ({
  deviceId: null,
  watchDate: null,
  watchSecondsToday: 0,
  dailyTimeLimitMinutes: 60,
  snoozeBonusSeconds: 0,
  isLimitReached: false,

  resetForDevice: (deviceId) => {
    const trimmed = deviceId?.trim() || null
    if (!trimmed) {
      clearPersistedSnooze()
      set({
        deviceId: null,
        watchDate: null,
        watchSecondsToday: 0,
        dailyTimeLimitMinutes: 60,
        snoozeBonusSeconds: 0,
        isLimitReached: false,
      })
      return
    }
    set({
      deviceId: trimmed,
      watchDate: null,
      watchSecondsToday: 0,
      dailyTimeLimitMinutes: 60,
      snoozeBonusSeconds: 0,
      isLimitReached: false,
    })
  },

  applyWatchState: (state) => {
    const deviceId = state.deviceId.trim()
    const snoozeBonusSeconds = readPersistedSnooze(deviceId, state.watchDate)
    set({
      deviceId,
      watchDate: state.watchDate,
      watchSecondsToday: state.watchSecondsToday,
      dailyTimeLimitMinutes: state.dailyTimeLimitMinutes,
      snoozeBonusSeconds,
      isLimitReached: computeLimitReached(
        state.watchSecondsToday,
        state.dailyTimeLimitMinutes,
        snoozeBonusSeconds
      ),
    })
  },

  incrementLocalWatchSeconds: (delta = 1) => {
    const add = Math.max(0, Math.floor(delta))
    if (add <= 0) return
    const {
      watchSecondsToday,
      dailyTimeLimitMinutes,
      snoozeBonusSeconds,
      isLimitReached,
    } = get()
    const nextWatch = watchSecondsToday + add
    const nextLimitReached = computeLimitReached(
      nextWatch,
      dailyTimeLimitMinutes,
      snoozeBonusSeconds
    )
    if (nextWatch === watchSecondsToday && nextLimitReached === isLimitReached) return
    set({
      watchSecondsToday: nextWatch,
      isLimitReached: nextLimitReached,
    })
  },

  applyServerTotals: (watchSecondsToday, dailyTimeLimitMinutes) => {
    const { snoozeBonusSeconds } = get()
    set({
      watchSecondsToday,
      dailyTimeLimitMinutes,
      isLimitReached: computeLimitReached(
        watchSecondsToday,
        dailyTimeLimitMinutes,
        snoozeBonusSeconds
      ),
    })
  },

  snoozeMinutes: (minutes = DAILY_WATCH_SNOOZE_MINUTES) => {
    const { deviceId, watchDate, watchSecondsToday, dailyTimeLimitMinutes, snoozeBonusSeconds } =
      get()
    if (!deviceId || !watchDate) return
    const bonus = Math.max(1, minutes) * 60
    const nextSnooze = snoozeBonusSeconds + bonus
    writePersistedSnooze(deviceId, watchDate, nextSnooze)
    set({
      snoozeBonusSeconds: nextSnooze,
      isLimitReached: computeLimitReached(
        watchSecondsToday,
        dailyTimeLimitMinutes,
        nextSnooze
      ),
    })
  },
}))
