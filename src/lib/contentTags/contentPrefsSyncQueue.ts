import { supabase } from '../supabase'
import { isLocalParentSessionValid, readLocalParentSession } from '../localParentAdmin'
import { humanizeSupabaseError } from '../supabaseErrorMessage'
import {
  readContentPrefsQueue,
  writeContentPrefsQueue,
  type QueuedContentPrefsUpdate,
} from './tagOfflineCache'
import { mapDeviceContentPrefs } from './tagPreferences'
import { cacheDeviceContentPrefs } from './tagOfflineCache'

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
    const queue = readContentPrefsQueue()
    if (queue.length === 0) return { flushed: 0, failed: 0 }

    const remaining: QueuedContentPrefsUpdate[] = []
    const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null

    for (const item of queue) {
      const { data, error } = localSession?.accessToken
        ? await supabase.rpc('local_parent_update_device_tag_preferences', {
            p_access_token: localSession.accessToken,
            p_preferences: item.preferences,
          })
        : await supabase.rpc('parent_update_device_tag_preferences', {
            p_device_id: item.deviceId,
            p_preferences: item.preferences,
          })

      if (!error && data) {
        const mapped = mapDeviceContentPrefs(data)
        cacheDeviceContentPrefs(item.deviceId, mapped)
        flushed++
        continue
      }

      const attempts = item.attempts + 1
      if (attempts >= 8) {
        console.warn('[contentPrefsSyncQueue] dropping exhausted item', item.deviceId, error?.message)
        failed++
        continue
      }
      remaining.push({ ...item, attempts })
    }

    writeContentPrefsQueue(remaining)
    return { flushed, failed }
  } catch (err) {
    console.warn('[contentPrefsSyncQueue] flush failed', humanizeSupabaseError(String(err)))
    return { flushed, failed: 1 }
  } finally {
    flushing = false
  }
}

export function initContentPrefsSyncQueue(): void {
  if (typeof window === 'undefined') return

  const scheduleFlush = () => {
    void flushQueueInternal()
  }

  window.addEventListener('online', scheduleFlush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFlush()
  })
  window.setTimeout(scheduleFlush, 3_000)
}

export function hasPendingContentPrefsSync(): boolean {
  return readContentPrefsQueue().length > 0
}
