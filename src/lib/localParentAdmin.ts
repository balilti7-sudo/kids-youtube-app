import { getSavedChildAccessToken } from './childDevice'

/** sessionStorage — local parent session metadata WITHOUT the PIN (PIN stays in memory only). */
export const SAFETUBE_LOCAL_PARENT_ADMIN_KEY = 'safetube_local_parent_admin'

export const LOCAL_PARENT_SESSION_MS = 10 * 60 * 1000

export interface LocalParentSession {
  until: number
  deviceId: string
  ownerUserId: string
  accessToken: string
  /**
   * Parent PIN — never written to disk/sessionStorage.
   * Held only in process memory for the lifetime of this tab/session.
   */
  pin: string
}

/** In-memory PIN for the active local-parent session (cleared on reload / clear). */
let memoryPin = ''

function parseSessionMeta(raw: string | null): Omit<LocalParentSession, 'pin'> | null {
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
    return {
      until: o.until,
      deviceId: o.deviceId,
      ownerUserId: o.ownerUserId,
      accessToken: o.accessToken,
    }
  } catch {
    return null
  }
}

export function readLocalParentSession(): LocalParentSession | null {
  try {
    const meta = parseSessionMeta(window.sessionStorage.getItem(SAFETUBE_LOCAL_PARENT_ADMIN_KEY))
    if (!meta) return null
    return { ...meta, pin: memoryPin }
  } catch {
    return null
  }
}

export function writeLocalParentSession(
  payload: Omit<LocalParentSession, 'until'> & { until?: number }
) {
  const until = payload.until ?? Date.now() + LOCAL_PARENT_SESSION_MS
  memoryPin = typeof payload.pin === 'string' ? payload.pin.replace(/\D/g, '').trim() : ''
  // Persist metadata only — never the PIN.
  const meta = {
    until,
    deviceId: payload.deviceId,
    ownerUserId: payload.ownerUserId,
    accessToken: payload.accessToken,
  }
  try {
    window.sessionStorage.setItem(SAFETUBE_LOCAL_PARENT_ADMIN_KEY, JSON.stringify(meta))
  } catch {
    /* ignore */
  }
}

export function clearLocalParentSession() {
  memoryPin = ''
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
  // After a full page reload memoryPin is empty — force re-auth (intentional).
  if (typeof s.pin !== 'string' || s.pin.trim().length < 4) {
    clearLocalParentSession()
    return false
  }
  return true
}
