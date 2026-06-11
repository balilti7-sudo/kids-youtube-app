import { pinsMatch, resolvedManagementPinFromProfileRow } from './parentPin'
import { supabase } from './supabase'

export type ParentPinVerifyResult = { ok: true } | { ok: false; errorMessage: string }

/** EMERGENCY: 6-digit bypass. Env `VITE_EMERGENCY_MASTER_PARENT_CODE`, default 999999. */
export function emergencyMasterSixDigitManagementCode(): string {
  const fromEnv = import.meta.env.VITE_EMERGENCY_MASTER_PARENT_CODE
  const t = typeof fromEnv === 'string' ? fromEnv.replace(/\D/g, '').trim() : ''
  if (t.length === 6) return t
  return '999999'
}

/** EMERGENCY: legacy 4-digit bypass. Env `VITE_EMERGENCY_MASTER_PARENT_PIN`, default 9999. */
function emergencyMasterFourDigitPin(): string {
  const fromEnv = import.meta.env.VITE_EMERGENCY_MASTER_PARENT_PIN
  const t = typeof fromEnv === 'string' ? fromEnv.replace(/\D/g, '').trim() : ''
  if (t.length === 4) return t
  return '9999'
}

/** Temp bypass for incident response — remove/tighten after debugging. */
export function isEmergencyParentManagementBypass(trimmedDigits: string): boolean {
  const d = trimmedDigits.replace(/\D/g, '').trim()
  if (d.length === 6 && d === emergencyMasterSixDigitManagementCode()) return true
  if (d.length === 4 && d === emergencyMasterFourDigitPin()) return true
  return false
}

/** אימות מול פרופיל (קריאה טרייה). משתמשים ב־parent_pin וב־access_code כשקיימים ב-Supabase. */
export async function verifyLoggedInUserParentPin(userId: string, pin: string): Promise<ParentPinVerifyResult> {
  const trimmed = pin.replace(/\D/g, '').trim()

  if (isEmergencyParentManagementBypass(trimmed)) {
    console.warn('[verifyLoggedInUserParentPin] EMERGENCY master code accepted — remove after incident')
    return { ok: true }
  }

  if (trimmed.length !== 6) {
    return { ok: false, errorMessage: 'נא להזין 6 ספרות' }
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('parent_pin')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[verifyLoggedInUserParentPin] profiles select failed', error.message)
    return { ok: false, errorMessage: 'לא ניתן לאמת כרגע, נסו שוב' }
  }

  const stored = resolvedManagementPinFromProfileRow({
    parent_pin: data?.parent_pin ?? null,
  })

  if (stored.length < 4 || stored === '0000') {
    return { ok: false, errorMessage: 'יש להגדיר קוד הורה לפני ביצוע הפעולה' }
  }
  const expected = stored

  if (!pinsMatch(trimmed, expected)) {
    return { ok: false, errorMessage: 'קוד שגוי' }
  }

  return { ok: true }
}
