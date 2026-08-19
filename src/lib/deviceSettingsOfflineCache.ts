import type { DeviceSettingsUpdate } from './deviceSettings'

const CACHE_KEY = 'safetube_device_settings_cache_v1'
const QUEUE_KEY = 'safetube_device_settings_queue_v1'

export type DeviceSettingsFields = {
  allow_shorts: boolean
  block_youtube_app: boolean
  browser_filter_enabled: boolean
  browser_whitelist: string[]
  daily_time_limit_minutes: number
  hide_thumbnails: boolean
}

export type CachedDeviceSettings = {
  deviceId: string
  userId?: string
  updatedAt: number
  fields: DeviceSettingsFields
}

export type QueuedDeviceSettingsUpdate = {
  id: string
  deviceId: string
  updates: DeviceSettingsUpdate
  createdAt: number
  attempts: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / private mode */
  }
}

export function cacheDeviceSettings(
  deviceId: string,
  fields: DeviceSettingsFields,
  userId?: string
): void {
  const all = readJson<Record<string, CachedDeviceSettings>>(CACHE_KEY, {})
  all[deviceId] = {
    deviceId,
    userId,
    updatedAt: Date.now(),
    fields: {
      ...fields,
      browser_whitelist: Array.isArray(fields.browser_whitelist)
        ? [...fields.browser_whitelist]
        : [],
    },
  }
  writeJson(CACHE_KEY, all)
}

export function readCachedDeviceSettings(deviceId: string): CachedDeviceSettings | null {
  const all = readJson<Record<string, CachedDeviceSettings>>(CACHE_KEY, {})
  return all[deviceId] ?? null
}

export function readCachedDevicesForUser(userId: string): CachedDeviceSettings[] {
  const all = readJson<Record<string, CachedDeviceSettings>>(CACHE_KEY, {})
  return Object.values(all).filter((c) => c.userId === userId)
}

export function enqueueDeviceSettingsUpdate(deviceId: string, updates: DeviceSettingsUpdate): void {
  const queue = readJson<QueuedDeviceSettingsUpdate[]>(QUEUE_KEY, [])
  queue.push({
    id: `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId,
    updates,
    createdAt: Date.now(),
    attempts: 0,
  })
  writeJson(QUEUE_KEY, queue)
}

export function readDeviceSettingsQueue(): QueuedDeviceSettingsUpdate[] {
  return readJson<QueuedDeviceSettingsUpdate[]>(QUEUE_KEY, [])
}

export function writeDeviceSettingsQueue(queue: QueuedDeviceSettingsUpdate[]): void {
  writeJson(QUEUE_KEY, queue)
}

export function mergeDeviceSettingsFields(
  current: DeviceSettingsFields,
  updates: DeviceSettingsUpdate
): DeviceSettingsFields {
  return {
    allow_shorts: typeof updates.allowShorts === 'boolean' ? updates.allowShorts : current.allow_shorts,
    block_youtube_app:
      typeof updates.blockYoutubeApp === 'boolean' ? updates.blockYoutubeApp : current.block_youtube_app,
    browser_filter_enabled:
      typeof updates.browserFilterEnabled === 'boolean'
        ? updates.browserFilterEnabled
        : current.browser_filter_enabled,
    browser_whitelist: Array.isArray(updates.browserWhitelist)
      ? updates.browserWhitelist.map((h) => String(h ?? '').trim()).filter(Boolean)
      : current.browser_whitelist,
    daily_time_limit_minutes:
      typeof updates.dailyTimeLimitMinutes === 'number' && Number.isFinite(updates.dailyTimeLimitMinutes)
        ? Math.round(updates.dailyTimeLimitMinutes)
        : current.daily_time_limit_minutes,
    hide_thumbnails:
      typeof updates.hideThumbnails === 'boolean' ? updates.hideThumbnails : current.hide_thumbnails,
  }
}
