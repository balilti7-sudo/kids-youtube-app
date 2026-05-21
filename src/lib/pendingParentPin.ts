import { supabase } from './supabase'
import { isProfileParentPinMissing, isValidParentPinDigits, PARENT_PIN_DIGIT_MAX } from './parentPin'
import { requestPinEmail } from './requestPinEmail'
import type { Profile } from '../types'

const STORAGE_KEY = 'safetube_pending_parent_pin_v1'

type PendingRecord = { email: string; pin: string }

function normEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function savePendingParentPin(email: string, pin: string): void {
  if (typeof window === 'undefined') return
  const record: PendingRecord = { email: normEmail(email), pin: pin.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX) }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* ignore */
  }
}

export function readPendingParentPin(email: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingRecord
    if (!parsed?.email || !parsed?.pin) return null
    if (normEmail(parsed.email) !== normEmail(email)) return null
    if (!isValidParentPinDigits(parsed.pin)) return null
    return parsed.pin
  } catch {
    return null
  }
}

export function clearPendingParentPin(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * After first login, apply the PIN chosen at registration (if profile still has no PIN).
 */
export async function applyPendingParentPinForProfile(
  userId: string,
  userEmail: string | null | undefined,
  profile: Profile | null
): Promise<Profile | null> {
  if (!profile || !isProfileParentPinMissing(profile)) return profile
  const email = userEmail || profile.email
  if (!email) return profile

  const pending = readPendingParentPin(email)
  if (!pending) return profile

  const { error } = await supabase.from('profiles').update({ parent_pin: pending }).eq('id', userId)
  if (error) {
    console.warn('[pendingParentPin] update failed:', error.message)
    return profile
  }

  requestPinEmail({ email, pin: pending, accessToken: null })
  clearPendingParentPin()

  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  return (data as Profile | null) ?? { ...profile, parent_pin: pending }
}
