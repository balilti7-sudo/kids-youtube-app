import { supabase } from './supabase'
import { isProfileParentPinMissing, isValidParentPinDigits, PARENT_PIN_DIGIT_MAX } from './parentPin'
import { requestPinEmail } from './requestPinEmail'
import type { Profile } from '../types'

/** In-memory only — never persist plaintext PIN + email to sessionStorage. */
const pendingByEmail = new Map<string, string>()

function normEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function savePendingParentPin(email: string, pin: string): void {
  const key = normEmail(email)
  const digits = pin.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX)
  if (!key || !isValidParentPinDigits(digits)) return
  pendingByEmail.set(key, digits)
}

export function readPendingParentPin(email: string): string | null {
  const key = normEmail(email)
  const pin = pendingByEmail.get(key) ?? null
  if (!pin || !isValidParentPinDigits(pin)) return null
  return pin
}

export function clearPendingParentPin(): void {
  pendingByEmail.clear()
}

/**
 * After first login, apply the PIN chosen at registration (if profile still has no PIN).
 * Uses set_parent_pin RPC when available (hashed); falls back to direct update only if RPC missing.
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

  const { data: rpcData, error: rpcError } = await supabase.rpc('set_parent_pin', { p_new_pin: pending })
  let applied = false
  if (!rpcError && rpcData && typeof rpcData === 'object' && (rpcData as { ok?: boolean }).ok === true) {
    applied = true
  } else if (
    rpcError &&
    /set_parent_pin/i.test(rpcError.message || '') &&
    /not find|does not exist|42883/i.test(rpcError.message || '')
  ) {
    const { error } = await supabase.from('profiles').update({ parent_pin: pending }).eq('id', userId)
    if (error) {
      console.warn('[pendingParentPin] update failed:', error.message)
      return profile
    }
    applied = true
  } else if (rpcError) {
    console.warn('[pendingParentPin] set_parent_pin failed:', rpcError.message)
    return profile
  }

  if (!applied) return profile

  const { data: sessionData } = await supabase.auth.getSession()
  const emailResult = await requestPinEmail({
    email,
    pin: pending,
    accessToken: sessionData.session?.access_token ?? null,
  })
  if (!emailResult.ok && !emailResult.skipped) {
    console.warn('[pendingParentPin] PIN email failed')
  }
  clearPendingParentPin()

  const { data } = await supabase
    .from('profiles')
    .select('id,email,full_name,onboarding_done,parent_pin,parent_pin_hash,access_code,created_at')
    .eq('id', userId)
    .maybeSingle()
  return (data as Profile | null) ?? { ...profile, parent_pin: null, parent_pin_hash: 'set' }
}
