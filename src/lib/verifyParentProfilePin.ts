import { pinsMatch, resolvedManagementPinFromProfileRow } from './parentPin'
import { supabase } from './supabase'

export type ParentPinVerifyResult = { ok: true } | { ok: false; errorMessage: string }

/**
 * Optional emergency bypass — ONLY when an explicit non-default env value is set.
 * Never ships hardcoded 9999 / 999999 defaults in production builds.
 */
export function emergencyMasterSixDigitManagementCode(): string {
  const fromEnv = import.meta.env.VITE_EMERGENCY_MASTER_PARENT_CODE
  const t = typeof fromEnv === 'string' ? fromEnv.replace(/\D/g, '').trim() : ''
  if (t.length === 6 && t !== '999999') return t
  return ''
}

function emergencyMasterFourDigitPin(): string {
  const fromEnv = import.meta.env.VITE_EMERGENCY_MASTER_PARENT_PIN
  const t = typeof fromEnv === 'string' ? fromEnv.replace(/\D/g, '').trim() : ''
  if (t.length === 4 && t !== '9999') return t
  return ''
}

/** Temp bypass for incident response — disabled unless a custom env code is configured. */
export function isEmergencyParentManagementBypass(trimmedDigits: string): boolean {
  const d = trimmedDigits.replace(/\D/g, '').trim()
  const six = emergencyMasterSixDigitManagementCode()
  const four = emergencyMasterFourDigitPin()
  if (six && d.length === 6 && d === six) return true
  if (four && d.length === 4 && d === four) return true
  return false
}

const RPC_ERROR_HE: Record<string, string> = {
  not_authenticated: 'יש להתחבר מחדש',
  invalid_pin_format: 'נא להזין 6 ספרות',
  profile_not_found: 'פרופיל לא נמצא',
  pin_not_configured: 'יש להגדיר קוד הורה לפני ביצוע הפעולה',
  wrong_pin: 'קוד שגוי',
}

/** אימות מול השרת (verify_parent_pin RPC) — לא שולפים plaintext parent_pin ללקוח. */
export async function verifyLoggedInUserParentPin(userId: string, pin: string): Promise<ParentPinVerifyResult> {
  const trimmed = pin.replace(/\D/g, '').trim()

  if (isEmergencyParentManagementBypass(trimmed)) {
    if (import.meta.env.DEV) {
      console.warn('[verifyLoggedInUserParentPin] EMERGENCY master code accepted (dev only path)')
    }
    return { ok: true }
  }

  if (trimmed.length !== 6) {
    return { ok: false, errorMessage: 'נא להזין 6 ספרות' }
  }

  if (!userId.trim()) {
    return { ok: false, errorMessage: 'יש להתחבר מחדש' }
  }

  const { data, error } = await supabase.rpc('verify_parent_pin', { p_pin: trimmed })

  if (!error && data && typeof data === 'object') {
    const row = data as { ok?: boolean; error?: string }
    if (row.ok === true) return { ok: true }
    const code = String(row.error || '')
    return { ok: false, errorMessage: RPC_ERROR_HE[code] || 'קוד שגוי' }
  }

  // Fallback when migration 068 is not applied yet: compare locally (legacy plaintext).
  if (error && /verify_parent_pin/i.test(error.message || '') && /not find|does not exist|42883/i.test(error.message || '')) {
    const { data: profile, error: selectError } = await supabase
      .from('profiles')
      .select('parent_pin')
      .eq('id', userId)
      .maybeSingle()

    if (selectError) {
      console.warn('[verifyLoggedInUserParentPin] profiles select failed', selectError.message)
      return { ok: false, errorMessage: 'לא ניתן לאמת כרגע, נסו שוב' }
    }

    const stored = resolvedManagementPinFromProfileRow({
      parent_pin: profile?.parent_pin ?? null,
    })

    if (stored.length < 4 || stored === '0000') {
      return { ok: false, errorMessage: 'יש להגדיר קוד הורה לפני ביצוע הפעולה' }
    }

    if (!pinsMatch(trimmed, stored)) {
      return { ok: false, errorMessage: 'קוד שגוי' }
    }
    return { ok: true }
  }

  if (error) {
    console.warn('[verifyLoggedInUserParentPin] RPC failed', error.message)
    return { ok: false, errorMessage: 'לא ניתן לאמת כרגע, נסו שוב' }
  }

  return { ok: false, errorMessage: 'קוד שגוי' }
}
