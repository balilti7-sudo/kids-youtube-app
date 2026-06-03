import { create } from 'zustand'

export const BEDTIME_ROUTINE_COUNTDOWN_MINUTES = 5
export const BEDTIME_ROUTINE_COUNTDOWN_MS = BEDTIME_ROUTINE_COUNTDOWN_MINUTES * 60 * 1000

const STORAGE_KEY = 'safetube_bedtime_routine_v1'

type Persisted = {
  deviceId: string
  countdownEndsAt: number | null
  isRoutineActive: boolean
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
  isRoutineActive: boolean
  countdownEndsAt: number | null
  activeDeviceId: string | null
  /** Seconds left in the pre-routine countdown (0 when inactive or expired). */
  countdownRemainingSeconds: number
  startCountdown: (deviceId: string, minutes?: number) => void
  activateRoutine: () => void
  deactivateRoutine: () => void
  syncCountdownTick: (now?: number) => void
  hydrateForDevice: (deviceId: string | null) => void
}

export const useBedtimeRoutineStore = create<BedtimeRoutineStore>((set, get) => ({
  isRoutineActive: false,
  countdownEndsAt: null,
  activeDeviceId: null,
  countdownRemainingSeconds: 0,

  startCountdown: (deviceId, minutes = BEDTIME_ROUTINE_COUNTDOWN_MINUTES) => {
    const trimmed = deviceId.trim()
    if (!trimmed) return
    const endsAt = Date.now() + Math.max(1, minutes) * 60 * 1000
    set({
      activeDeviceId: trimmed,
      countdownEndsAt: endsAt,
      isRoutineActive: false,
      countdownRemainingSeconds: Math.ceil((endsAt - Date.now()) / 1000),
    })
    writePersisted({
      deviceId: trimmed,
      countdownEndsAt: endsAt,
      isRoutineActive: false,
    })
  },

  activateRoutine: () => {
    const deviceId = get().activeDeviceId
    if (!deviceId) return
    set({
      isRoutineActive: true,
      countdownEndsAt: null,
      countdownRemainingSeconds: 0,
    })
    writePersisted({
      deviceId,
      countdownEndsAt: null,
      isRoutineActive: true,
    })
  },

  deactivateRoutine: () => {
    clearPersisted()
    set({
      isRoutineActive: false,
      countdownEndsAt: null,
      activeDeviceId: null,
      countdownRemainingSeconds: 0,
    })
  },

  syncCountdownTick: (now = Date.now()) => {
    const { countdownEndsAt, isRoutineActive, activeDeviceId } = get()
    if (isRoutineActive || !countdownEndsAt || !activeDeviceId) {
      if (get().countdownRemainingSeconds !== 0) {
        set({ countdownRemainingSeconds: 0 })
      }
      return
    }
    const remainingMs = countdownEndsAt - now
    if (remainingMs <= 0) {
      get().activateRoutine()
      return
    }
    const seconds = Math.ceil(remainingMs / 1000)
    if (seconds !== get().countdownRemainingSeconds) {
      set({ countdownRemainingSeconds: seconds })
    }
  },

  hydrateForDevice: (deviceId) => {
    const trimmed = deviceId?.trim() || null
    if (!trimmed) {
      get().deactivateRoutine()
      return
    }
    const saved = readPersisted()
    if (!saved || saved.deviceId !== trimmed) {
      set({
        activeDeviceId: trimmed,
        isRoutineActive: false,
        countdownEndsAt: null,
        countdownRemainingSeconds: 0,
      })
      return
    }
    if (saved.isRoutineActive) {
      set({
        activeDeviceId: trimmed,
        isRoutineActive: true,
        countdownEndsAt: null,
        countdownRemainingSeconds: 0,
      })
      return
    }
    if (saved.countdownEndsAt && saved.countdownEndsAt > Date.now()) {
      set({
        activeDeviceId: trimmed,
        isRoutineActive: false,
        countdownEndsAt: saved.countdownEndsAt,
        countdownRemainingSeconds: Math.ceil((saved.countdownEndsAt - Date.now()) / 1000),
      })
      get().syncCountdownTick()
      return
    }
    clearPersisted()
    set({
      activeDeviceId: trimmed,
      isRoutineActive: false,
      countdownEndsAt: null,
      countdownRemainingSeconds: 0,
    })
  },
}))
