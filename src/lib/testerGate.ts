import { Capacitor } from '@capacitor/core'
import { fetchTesterRemotePolicy, isFirebaseConfigured, type TesterRemotePolicy } from './firebase'

const UNLOCK_STORAGE_KEY = 'safetube_tester_unlock_v1'

export type TesterGateStatus =
  | { state: 'loading' }
  | { state: 'open' }
  | { state: 'locked'; reason: 'disabled' | 'need_code' | 'misconfigured'; message: string }
  | { state: 'error'; message: string }

type StoredUnlock = {
  code: string
  unlockedAt: number
}

function readStoredUnlock(): StoredUnlock | null {
  try {
    const raw = localStorage.getItem(UNLOCK_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredUnlock>
    if (typeof parsed.code !== 'string' || !parsed.code.trim()) return null
    return {
      code: parsed.code.trim(),
      unlockedAt: typeof parsed.unlockedAt === 'number' ? parsed.unlockedAt : Date.now(),
    }
  } catch {
    return null
  }
}

function writeStoredUnlock(code: string) {
  const payload: StoredUnlock = { code: code.trim(), unlockedAt: Date.now() }
  localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(payload))
}

export function clearTesterUnlock() {
  try {
    localStorage.removeItem(UNLOCK_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Gate applies to native APK builds; web/dev stay open unless forced. */
export function isTesterGateRequired(): boolean {
  const force = String(import.meta.env.VITE_TESTER_GATE || '').trim().toLowerCase()
  if (force === '0' || force === 'false' || force === 'off') return false
  if (force === '1' || force === 'true' || force === 'on') return true
  return Capacitor.isNativePlatform()
}

function normalizeCode(value: string): string {
  return value.trim()
}

function codesMatch(a: string, b: string): boolean {
  return normalizeCode(a).localeCompare(normalizeCode(b), undefined, { sensitivity: 'accent' }) === 0
}

export function evaluateTesterPolicy(policy: TesterRemotePolicy): TesterGateStatus {
  if (!policy.accessEnabled) {
    clearTesterUnlock()
    return {
      state: 'locked',
      reason: 'disabled',
      message: 'הגישה לבודקים כבויה כרגע מהדאשבורד. נסו שוב מאוחר יותר.',
    }
  }

  const expected = normalizeCode(policy.accessCode)
  if (!expected) {
    clearTesterUnlock()
    return {
      state: 'locked',
      reason: 'misconfigured',
      message: 'לא הוגדר קוד גישה ב-Firebase Remote Config (tester_access_code).',
    }
  }

  const stored = readStoredUnlock()
  if (stored && codesMatch(stored.code, expected)) {
    return { state: 'open' }
  }

  if (stored) clearTesterUnlock()
  return {
    state: 'locked',
    reason: 'need_code',
    message: 'הזינו את קוד הגישה שקיבלתם מהצוות כדי להמשיך.',
  }
}

export async function resolveTesterGateStatus(): Promise<TesterGateStatus> {
  if (!isTesterGateRequired()) return { state: 'open' }

  if (!isFirebaseConfigured()) {
    return {
      state: 'locked',
      reason: 'misconfigured',
      message:
        'Firebase לא מוגדר בבילד הזה. הוסיפו VITE_FIREBASE_* ב-.env.production ובנו APK מחדש.',
    }
  }

  try {
    const policy = await fetchTesterRemotePolicy()
    return evaluateTesterPolicy(policy)
  } catch (e) {
    return {
      state: 'error',
      message: e instanceof Error ? e.message : 'בדיקת גישה נכשלה',
    }
  }
}

export async function submitTesterAccessCode(input: string): Promise<TesterGateStatus> {
  if (!isTesterGateRequired()) return { state: 'open' }
  const code = normalizeCode(input)
  if (!code) {
    return { state: 'locked', reason: 'need_code', message: 'נא להזין קוד גישה.' }
  }

  const policy = await fetchTesterRemotePolicy()
  if (!policy.accessEnabled) {
    clearTesterUnlock()
    return {
      state: 'locked',
      reason: 'disabled',
      message: 'הגישה לבודקים כבויה כרגע מהדאשבורד.',
    }
  }

  if (!codesMatch(code, policy.accessCode)) {
    return {
      state: 'locked',
      reason: 'need_code',
      message: 'קוד שגוי. בדקו מול הצוות ונסו שוב.',
    }
  }

  writeStoredUnlock(code)
  return { state: 'open' }
}
