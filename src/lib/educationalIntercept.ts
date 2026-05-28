import type { EducationalInterceptFrequency } from '../types'

export const INTERCEPT_VIDEO_COUNT_KEY = 'safetube_intercept_video_count'
export const INTERCEPT_ACTIVE_KEY = 'safetube_intercept_active'
export const INTERCEPT_SCENE_PROGRESS_KEY = 'safetube_intercept_scene_progress'
export const INTERCEPT_PENDING_VIDEO_KEY = 'safetube_intercept_pending_video'
export const INTERCEPT_CHANGED_EVENT = 'safetube-intercept-changed'

export type InterceptPendingVideo = {
  videoId: string
  title?: string
  channelTitle?: string
  posterUrl?: string | null
}

export type InterceptSettings = {
  enabled: boolean
  frequency: EducationalInterceptFrequency
}

export const DEFAULT_INTERCEPT_SETTINGS: InterceptSettings = {
  enabled: false,
  frequency: 3,
}

function dispatchChanged() {
  try {
    window.dispatchEvent(new CustomEvent(INTERCEPT_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

function readCountRaw(): number {
  try {
    const raw = localStorage.getItem(INTERCEPT_VIDEO_COUNT_KEY)
    const n = raw != null ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function readInterceptVideoCount(): number {
  return readCountRaw()
}

export function writeInterceptVideoCount(count: number) {
  try {
    localStorage.setItem(INTERCEPT_VIDEO_COUNT_KEY, String(Math.max(0, count)))
    dispatchChanged()
  } catch {
    /* ignore */
  }
}

export function incrementInterceptVideoCount(): number {
  const next = readCountRaw() + 1
  writeInterceptVideoCount(next)
  return next
}

export function resetInterceptVideoCount() {
  writeInterceptVideoCount(0)
}

export function isInterceptSessionActive(): boolean {
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

export function activateInterceptSession(pendingVideo: InterceptPendingVideo) {
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

export function shouldTriggerIntercept(settings: InterceptSettings): boolean {
  if (!settings.enabled) return false
  if (isInterceptSessionActive()) return true
  return readInterceptVideoCount() >= settings.frequency
}

export function tryBeginPlayback(video: InterceptPendingVideo, settings: InterceptSettings): boolean {
  if (!settings.enabled) return true
  if (isInterceptSessionActive()) return false
  if (readInterceptVideoCount() >= settings.frequency) {
    activateInterceptSession(video)
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

export function completeInterceptSession() {
  resetInterceptVideoCount()
  clearInterceptSession()
}

export function settingsFromDevice(device: {
  educational_intercepts_enabled?: boolean
  educational_intercept_frequency?: number
} | null | undefined): InterceptSettings {
  if (!device) return DEFAULT_INTERCEPT_SETTINGS
  const freq = device.educational_intercept_frequency
  const frequency: EducationalInterceptFrequency = freq === 2 || freq === 5 ? freq : 3
  return {
    enabled: Boolean(device.educational_intercepts_enabled),
    frequency,
  }
}
