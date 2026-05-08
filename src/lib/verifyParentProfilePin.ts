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

  if (trimmed.length !== 4) {
    return { ok: false, errorMessage: 'נא להזין 4 ספרות' }
  }

  /** `*` — כדי שלא תיפול בקשה אם העמודה `access_code` עדיין לא נוספה ב-Supabase. */
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()

  if (error) {
    console.warn('[verifyLoggedInUserParentPin] profiles select failed', error.message)
    return { ok: false, errorMessage: 'לא ניתן לאמת כרגע, נסו שוב' }
  }

  const ppRaw = data?.parent_pin ?? null
  const acRaw = data?.access_code ?? null
  const stored = resolvedManagementPinFromProfileRow({
    parent_pin: ppRaw,
    access_code: acRaw,
  })

  console.log('[EMERGENCY DEBUG] parent gate:', {
    entered: trimmed,
    expectedFromProfiles: stored,
    profiles_parent_pin_raw: ppRaw,
    profiles_access_code_raw: acRaw,
  })

  if (stored.length < 4 || stored === '0000') {
    return { ok: false, errorMessage: 'יש להגדיר קוד הורה לפני ביצוע הפעולה' }
  }
  const expected = stored

  if (!pinsMatch(trimmed, expected)) {
    console.warn('[verifyLoggedInUserParentPin] mismatch', {
      entered: trimmed,
      expectedEffective: expected,
    })
    return { ok: false, errorMessage: 'קוד שגוי' }
  }

  return { ok: true }
}
