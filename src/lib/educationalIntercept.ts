import {
  EDUCATIONAL_BREAK_INTERVAL_MINUTES,
  type EducationalBreakIntervalMinutes,
} from '../types'

/**
 * When false, no watch timer, no break overlay, and playback is never blocked.
 * Re-enable after the time-based break system is fully implemented and tested.
 */
export const EDUCATIONAL_BREAKS_RUNTIME_ENABLED = true

export const INTERCEPT_ACTIVE_KEY = 'safetube_intercept_active'
export const INTERCEPT_SCENE_PROGRESS_KEY = 'safetube_intercept_scene_progress'
export const INTERCEPT_PENDING_VIDEO_KEY = 'safetube_intercept_pending_video'
export const INTERCEPT_CHANGED_EVENT = 'safetube-intercept-changed'

const WATCH_SECONDS_PREFIX = 'safetube_intercept_watch_seconds_'

export type InterceptPendingVideo = {
  videoId: string
  title?: string
  channelTitle?: string
  posterUrl?: string | null
}

export type InterceptSettings = {
  enabled: boolean
  intervalMinutes: EducationalBreakIntervalMinutes
}

export const DEFAULT_INTERCEPT_SETTINGS: InterceptSettings = {
  enabled: false,
  intervalMinutes: 30,
}

function dispatchChanged() {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return
  try {
    window.dispatchEvent(new CustomEvent(INTERCEPT_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

export function interceptWatchKey(deviceId: string): string {
  return `${WATCH_SECONDS_PREFIX}${deviceId}`
}

function readWatchRaw(deviceId: string): number {
  try {
    const raw = localStorage.getItem(interceptWatchKey(deviceId))
    const n = raw != null ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function readInterceptWatchSeconds(deviceId: string): number {
  return readWatchRaw(deviceId)
}

export function writeInterceptWatchSeconds(deviceId: string, seconds: number) {
  try {
    localStorage.setItem(interceptWatchKey(deviceId), String(Math.max(0, Math.round(seconds))))
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

export function addInterceptWatchSeconds(deviceId: string, deltaSeconds: number): number {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return 0
  const next = readWatchRaw(deviceId) + Math.max(0, deltaSeconds)
  writeInterceptWatchSeconds(deviceId, next)
  return next
}

export function resetInterceptWatchSeconds(deviceId: string) {
  writeInterceptWatchSeconds(deviceId, 0)
}

export function isInterceptSessionActive(): boolean {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return false
  try {
    return localStorage.getItem(INTERCEPT_ACTIVE_KEY) === '1'
  } catch {
    return false
  }
}

export function readInterceptSceneProgress(): string[] {
  try {
    const raw = localStorage.getItem(INTERCEPT_SCENE_PROGRESS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

export function writeInterceptSceneProgress(fixedItemIds: string[]) {
  try {
    localStorage.setItem(INTERCEPT_SCENE_PROGRESS_KEY, JSON.stringify(fixedItemIds))
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

export function readInterceptPendingVideo(): InterceptPendingVideo | null {
  try {
    const raw = localStorage.getItem(INTERCEPT_PENDING_VIDEO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as InterceptPendingVideo
    if (!parsed?.videoId?.trim()) return null
    return parsed
  } catch {
    return null
  }
}

export function writeInterceptPendingVideo(video: InterceptPendingVideo | null) {
  try {
    if (!video) {
      localStorage.removeItem(INTERCEPT_PENDING_VIDEO_KEY)
    } else {
      localStorage.setItem(INTERCEPT_PENDING_VIDEO_KEY, JSON.stringify(video))
    }
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

export function activateInterceptSession(_deviceId: string, pendingVideo: InterceptPendingVideo) {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return
  try {
    localStorage.setItem(INTERCEPT_ACTIVE_KEY, '1')
    writeInterceptSceneProgress([])
    writeInterceptPendingVideo(pendingVideo)
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

export function clearInterceptSession() {
  try {
    localStorage.removeItem(INTERCEPT_ACTIVE_KEY)
    localStorage.removeItem(INTERCEPT_SCENE_PROGRESS_KEY)
    localStorage.removeItem(INTERCEPT_PENDING_VIDEO_KEY)
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

/** Clears stuck break session + per-device watch counters (call when breaks are off). */
export function clearAllEducationalBreakLocalState() {
  clearInterceptSession()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(WATCH_SECONDS_PREFIX)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* ignore */
  }
}

if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED && typeof window !== 'undefined') {
  clearAllEducationalBreakLocalState()
}
// When enabled, watch time is tracked server-side (intercept_watch_seconds) and in useEducationalWatchTimer.

export function interceptThresholdSeconds(settings: InterceptSettings): number {
  return settings.intervalMinutes * 60
}

export function shouldTriggerIntercept(deviceId: string, settings: InterceptSettings): boolean {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return false
  if (!settings.enabled || !deviceId.trim()) return false
  if (isInterceptSessionActive()) return true
  return readInterceptWatchSeconds(deviceId) >= interceptThresholdSeconds(settings)
}

export function tryBeginPlayback(
  deviceId: string,
  video: InterceptPendingVideo,
  settings: InterceptSettings
): boolean {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return true
  if (!settings.enabled || !deviceId.trim()) return true
  if (isInterceptSessionActive()) return false
  if (readInterceptWatchSeconds(deviceId) >= interceptThresholdSeconds(settings)) {
    activateInterceptSession(deviceId, video)
    return false
  }
  return true
}

export function markSceneItemFixed(itemId: string): string[] {
  const current = readInterceptSceneProgress()
  if (current.includes(itemId)) return current
  const next = [...current, itemId]
  writeInterceptSceneProgress(next)
  return next
}

export function completeInterceptSession(deviceId: string) {
  resetInterceptWatchSeconds(deviceId)
  clearInterceptSession()
}

export function settingsFromDevice(device: {
  educational_intercept_enabled?: boolean
  educational_intercepts_enabled?: boolean
  break_interval_minutes?: number | string | null
  educational_intercept_frequency?: number | string
} | null | undefined): InterceptSettings {
  if (!device) return DEFAULT_INTERCEPT_SETTINGS
  return {
    enabled: Boolean(device.educational_intercept_enabled ?? device.educational_intercepts_enabled),
    intervalMinutes: normalizeBreakIntervalFromDevice(
      device.break_interval_minutes ?? device.educational_intercept_frequency
    ),
  }
}

export function normalizeBreakIntervalFromDevice(raw: unknown): EducationalBreakIntervalMinutes {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? '30').trim(), 10)
  if ((EDUCATIONAL_BREAK_INTERVAL_MINUTES as readonly number[]).includes(n)) {
    return n as EducationalBreakIntervalMinutes
  }
  // Legacy educational_intercept_frequency video-count codes (2/3/5) → minutes.
  if (n === 2) return 15
  if (n === 3) return 30
  if (n === 5) return 45
  return 30
}
