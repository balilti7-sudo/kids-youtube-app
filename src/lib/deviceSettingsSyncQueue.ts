import { parentUpdateDeviceSettings } from './deviceSettings'
import {
  readDeviceSettingsQueue,
  writeDeviceSettingsQueue,
  type QueuedDeviceSettingsUpdate,
} from './deviceSettingsOfflineCache'
import { humanizeSupabaseError } from './supabaseErrorMessage'

const FLUSH_COOLDOWN_MS = 4_000
let flushing = false
let lastFlushAt = 0

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

async function flushQueueInternal(): Promise<{ flushed: number; failed: number }> {
  if (!isOnline()) return { flushed: 0, failed: 0 }
  const now = Date.now()
  if (flushing || now - lastFlushAt < FLUSH_COOLDOWN_MS) return { flushed: 0, failed: 0 }

  flushing = true
  lastFlushAt = now
  let flushed = 0
  let failed = 0

  try {
    const queue = readDeviceSettingsQueue()
    if (queue.length === 0) return { flushed: 0, failed: 0 }

    const remaining: QueuedDeviceSettingsUpdate[] = []

    for (const item of queue) {
      const { data, error } = await parentUpdateDeviceSettings(item.deviceId, item.updates)
      if (!error && data) {
        flushed++
        continue
      }
      const attempts = item.attempts + 1
      if (attempts >= 8) {
        console.warn('[deviceSettingsSyncQueue] dropping exhausted queue item', item.deviceId, error?.message)
        failed++
        continue
      }
      remaining.push({ ...item, attempts })
    }

    writeDeviceSettingsQueue(remaining)
    return { flushed, failed }
  } catch (err) {
    console.warn('[deviceSettingsSyncQueue] flush failed', humanizeSupabaseError(String(err)))
    return { flushed, failed: 1 }
  } finally {
    flushing = false
  }
}

/** Retry queued Supabase device-settings writes when connectivity returns. */
export function initDeviceSettingsSyncQueue(): void {
  if (typeof window === 'undefined') return

  const scheduleFlush = () => {
    void flushQueueInternal()
  }

  window.addEventListener('online', scheduleFlush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFlush()
  })

  // Best-effort flush shortly after boot.
  window.setTimeout(scheduleFlush, 2_500)
}

export async function flushDeviceSettingsQueueNow(): Promise<{ flushed: number; failed: number }> {
  lastFlushAt = 0
  return flushQueueInternal()
}

export function hasPendingDeviceSettingsSync(): boolean {
  return readDeviceSettingsQueue().length > 0
}
