import { getSavedChildAccessToken } from './childDevice'

/** sessionStorage — סשן הורה מקומי (מכשיר מצומד + PIN) ללא התחברות Supabase */
export const SAFETUBE_LOCAL_PARENT_ADMIN_KEY = 'safetube_local_parent_admin'

export const LOCAL_PARENT_SESSION_MS = 30 * 60 * 1000

export interface LocalParentSession {
  until: number
  deviceId: string
  ownerUserId: string
  accessToken: string
  /** PIN הורי בגרסת plain רק לצורך קריאות RPC מקומיות מהדפדפן.
   *  נדרש כדי שלא יפתחו “פעולות ניהול” בלי שהמשתמש הזין PIN במסך ה-Kid. */
  pin: string
}

function parseSession(raw: string | null): LocalParentSession | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<LocalParentSession>
    if (
      typeof o.until !== 'number' ||
      typeof o.deviceId !== 'string' ||
      typeof o.ownerUserId !== 'string' ||
      typeof o.accessToken !== 'string'
    ) {
      return null
    }
    // pin יכול להיות חסר רק בנתונים ישנים שיוצרו לפני השדרוג.
    if (typeof o.pin !== 'string') {
      return {
        until: o.until,
        deviceId: String(o.deviceId),
        ownerUserId: String(o.ownerUserId),
        accessToken: String(o.accessToken),
        pin: '',
      }
    }
    return {
      until: o.until,
      deviceId: o.deviceId,
      ownerUserId: o.ownerUserId,
      accessToken: o.accessToken,
      pin: o.pin,
    }
  } catch {
    return null
  }
}

export function readLocalParentSession(): LocalParentSession | null {
  try {
    return parseSession(window.sessionStorage.getItem(SAFETUBE_LOCAL_PARENT_ADMIN_KEY))
  } catch {
    return null
  }
}

export function writeLocalParentSession(
  payload: Omit<LocalParentSession, 'until'> & { until?: number }
) {
  const until = payload.until ?? Date.now() + LOCAL_PARENT_SESSION_MS
  const s: LocalParentSession = {
    until,
    deviceId: payload.deviceId,
    ownerUserId: payload.ownerUserId,
    accessToken: payload.accessToken,
    pin: payload.pin,
  }
  try {
    window.sessionStorage.setItem(SAFETUBE_LOCAL_PARENT_ADMIN_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function clearLocalParentSession() {
  try {
    window.sessionStorage.removeItem(SAFETUBE_LOCAL_PARENT_ADMIN_KEY)
  } catch {
    /* ignore */
  }
}

export function isLocalParentSessionValid(): boolean {
  const token = getSavedChildAccessToken()
  if (!token) return false
  const s = readLocalParentSession()
  if (!s) return false
  if (s.until <= Date.now()) {
    clearLocalParentSession()
    return false
  }
  if (s.accessToken !== token) {
    clearLocalParentSession()
    return false
  }
  if (typeof s.pin !== 'string' || s.pin.trim().length < 4) {
    clearLocalParentSession()
    return false
  }
  return true
}
