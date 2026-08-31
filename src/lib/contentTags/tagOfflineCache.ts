import type { ContentTag, DeviceContentPrefs } from './types'

const CATALOG_CACHE_KEY = 'safetube_content_tags_catalog_v1'
const PREFS_CACHE_KEY = 'safetube_content_tags_prefs_v1'

type CachedCatalog = {
  updatedAt: number
  tags: ContentTag[]
}

type CachedPrefsStore = Record<
  string,
  {
    updatedAt: number
    prefs: DeviceContentPrefs
  }
>

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
    /* ignore quota */
  }
}

export function cacheContentTagCatalog(tags: ContentTag[]): void {
  const payload: CachedCatalog = { updatedAt: Date.now(), tags }
  writeJson(CATALOG_CACHE_KEY, payload)
}

export function readCachedContentTagCatalog(): ContentTag[] {
  const cached = readJson<CachedCatalog | null>(CATALOG_CACHE_KEY, null)
  return cached?.tags ?? []
}

export function cacheDeviceContentPrefs(deviceId: string, prefs: DeviceContentPrefs): void {
  const all = readJson<CachedPrefsStore>(PREFS_CACHE_KEY, {})
  all[deviceId] = { updatedAt: Date.now(), prefs }
  writeJson(PREFS_CACHE_KEY, all)
}

export function readCachedDeviceContentPrefs(deviceId: string): DeviceContentPrefs | null {
  const all = readJson<CachedPrefsStore>(PREFS_CACHE_KEY, {})
  return all[deviceId]?.prefs ?? null
}

export function clearDeviceContentPrefsCache(deviceId: string): void {
  const all = readJson<CachedPrefsStore>(PREFS_CACHE_KEY, {})
  delete all[deviceId]
  writeJson(PREFS_CACHE_KEY, all)
}

const PREFS_QUEUE_KEY = 'safetube_content_prefs_queue_v1'

export type QueuedContentPrefsUpdate = {
  id: string
  deviceId: string
  preferences: Array<{ tag_id: string; weight: number }>
  createdAt: number
  attempts: number
}

export function enqueueContentPrefsUpdate(
  deviceId: string,
  preferences: Array<{ tag_id: string; weight: number }>
): void {
  const queue = readJson<QueuedContentPrefsUpdate[]>(PREFS_QUEUE_KEY, [])
  queue.push({
    id: `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId,
    preferences,
    createdAt: Date.now(),
    attempts: 0,
  })
  writeJson(PREFS_QUEUE_KEY, queue)
}

export function readContentPrefsQueue(): QueuedContentPrefsUpdate[] {
  return readJson<QueuedContentPrefsUpdate[]>(PREFS_QUEUE_KEY, [])
}

export function writeContentPrefsQueue(queue: QueuedContentPrefsUpdate[]): void {
  writeJson(PREFS_QUEUE_KEY, queue)
}
