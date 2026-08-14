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

/** Gate only when Firebase is configured; web/dev stay open unless forced on. */
export function isTesterGateRequired(): boolean {
  const force = String(import.meta.env.VITE_TESTER_GATE || '').trim().toLowerCase()
  if (force === '0' || force === 'false' || force === 'off') return false
  // Without Firebase Remote Config there is nothing to enforce — never block launch.
  if (!isFirebaseConfigured()) return false
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
  // Remote Config unreachable / not fetched → do not lock the app.
  if (!policy.fetched) {
    return { state: 'open' }
  }

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
    // Misconfigured remote keys should not brick installs — open the app.
    console.warn('[testerGate] tester_access_code empty after fetch; leaving app open')
    return { state: 'open' }
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

  try {
    const policy = await fetchTesterRemotePolicy()
    return evaluateTesterPolicy(policy)
  } catch (e) {
    // Network / SDK errors must not block normal launch.
    console.warn('[testerGate] resolve failed; leaving app open', e)
    return { state: 'open' }
  }
}

export async function submitTesterAccessCode(input: string): Promise<TesterGateStatus> {
  if (!isTesterGateRequired()) return { state: 'open' }
  const code = normalizeCode(input)
  if (!code) {
    return { state: 'locked', reason: 'need_code', message: 'נא להזין קוד גישה.' }
  }

  try {
    const policy = await fetchTesterRemotePolicy()
    if (!policy.fetched) {
      return { state: 'open' }
    }
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
  } catch (e) {
    console.warn('[testerGate] submit failed; leaving app open', e)
    return { state: 'open' }
  }
}
