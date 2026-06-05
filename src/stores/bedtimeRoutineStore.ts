import { create } from 'zustand'

/**
 * Client state for bedtime UI only (dismiss/skip for tonight).
 * Grace timer is server-driven: grace_countdown_started_at + grace_period_minutes (migration 054).
 * No startCountdown / isRoutineActive — see bedtimeRoutinePhase.ts + BedtimeRoutineGate.
 */
const STORAGE_KEY = 'safetube_bedtime_routine_v1'

type Persisted = {
  deviceId: string
  dismissedRoutineDate: string | null
}

function readPersisted(): Persisted | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (!parsed?.deviceId) return null
    return parsed
  } catch {
    return null
  }
}

function writePersisted(state: Persisted) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

function clearPersisted() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export type BedtimeRoutineStore = {
  activeDeviceId: string | null
  /** Parent PIN-skipped routine for this calendar date (client-only until tomorrow). */
  dismissedRoutineDate: string | null
  dismissRoutineWithParentPin: (deviceId: string, routineDate: string) => void
  clearDismissedRoutineDate: () => void
  isRoutineDismissedForDate: (routineDate: string | null | undefined) => boolean
  hydrateForDevice: (deviceId: string | null) => void
  resetForDevice: () => void
}

export const useBedtimeRoutineStore = create<BedtimeRoutineStore>((set, get) => ({
  activeDeviceId: null,
  dismissedRoutineDate: null,

  dismissRoutineWithParentPin: (deviceId, routineDate) => {
    const trimmedDevice = deviceId.trim()
    const trimmedDate = routineDate.trim()
    if (!trimmedDevice || !trimmedDate) return
    set({
      activeDeviceId: trimmedDevice,
      dismissedRoutineDate: trimmedDate,
    })
    writePersisted({
      deviceId: trimmedDevice,
      dismissedRoutineDate: trimmedDate,
    })
  },

  clearDismissedRoutineDate: () => {
    const { activeDeviceId, dismissedRoutineDate } = get()
    if (!dismissedRoutineDate) return
    set({ dismissedRoutineDate: null })
    if (activeDeviceId) {
      writePersisted({
        deviceId: activeDeviceId,
        dismissedRoutineDate: null,
      })
    }
  },

  isRoutineDismissedForDate: (routineDate) => {
    const dismissed = get().dismissedRoutineDate
    if (!dismissed || !routineDate) return false
    return dismissed === routineDate.trim()
  },

  hydrateForDevice: (deviceId) => {
    const trimmed = deviceId?.trim() || null
    if (!trimmed) {
      get().resetForDevice()
      return
    }
    const saved = readPersisted()
    if (!saved || saved.deviceId !== trimmed) {
      set({
        activeDeviceId: trimmed,
        dismissedRoutineDate: null,
      })
      return
    }
    set({
      activeDeviceId: trimmed,
      dismissedRoutineDate: saved.dismissedRoutineDate ?? null,
    })
  },

  resetForDevice: () => {
    clearPersisted()
    set({
      activeDeviceId: null,
      dismissedRoutineDate: null,
    })
  },
}))
