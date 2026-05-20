import { isValidParentPinDigits, pinsMatch, resolvedManagementPinFromProfileRow } from './parentPin'
import { supabase } from './supabase'

export type ChangeParentPinResult = { ok: true } | { ok: false; message: string }

const WRONG_CURRENT_PIN_HE = 'קוד PIN נוכחי שגוי'

const RPC_ERROR_HE: Record<string, string> = {
  not_authenticated: 'יש להתחבר מחדש',
  wrong_current_pin: WRONG_CURRENT_PIN_HE,
  current_pin_required: 'נא להזין את קוד PIN הנוכחי',
  pin_too_short: 'הקוד החדש חייב להכיל בין 4 ל-6 ספרות',
  pin_too_long: 'הקוד החדש חייב להכיל בין 4 ל-6 ספרות',
  pin_not_numeric: 'הקוד חייב להכיל ספרות בלבד',
  profile_not_found: 'פרופיל לא נמצא',
}

function parseRpcResult(data: unknown): ChangeParentPinResult {
  if (!data || typeof data !== 'object') {
    return { ok: false, message: 'תשובה לא תקינה מהשרת' }
  }
  const row = data as { ok?: boolean; error?: string; message?: string }
  if (row.ok === true) return { ok: true }
  const code = String(row.error || '')
  return {
    ok: false,
    message: RPC_ERROR_HE[code] || row.message || code || 'עדכון הקוד נכשל',
  }
}

/** Fallback when RPC is missing (migration 027 not applied yet). */
async function changeViaDirectUpdate(
  userId: string,
  currentDigits: string,
  newDigits: string,
): Promise<ChangeParentPinResult> {
  const { data, error: selectError } = await supabase
    .from('profiles')
    .select('parent_pin')
    .eq('id', userId)
    .maybeSingle()

  if (selectError) {
    if (/access_code does not exist/i.test(selectError.message)) {
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 027_parent_pin_fix.sql',
      }
    }
    return { ok: false, message: selectError.message || 'לא ניתן לטעון את הקוד הנוכחי' }
  }

  if (!data) return { ok: false, message: 'פרופיל לא נמצא' }

  const stored = resolvedManagementPinFromProfileRow({ parent_pin: data.parent_pin })
  const pinConfigured = stored.length >= 4 && stored !== '0000'

  if (pinConfigured) {
    if (!isValidParentPinDigits(currentDigits)) {
      return { ok: false, message: 'נא להזין את קוד PIN הנוכחי' }
    }
    if (!pinsMatch(currentDigits, stored)) {
      return { ok: false, message: WRONG_CURRENT_PIN_HE }
    }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ parent_pin: newDigits })
    .eq('id', userId)

  if (updateError) {
    if (updateError.message?.includes('parent_pin_update_not_allowed')) {
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 027_parent_pin_fix.sql (מסיר חסימת עדכון PIN).',
      }
    }
    return { ok: false, message: updateError.message || 'עדכון הקוד נכשל' }
  }

  return { ok: true }
}

/**
 * Change parent PIN via Supabase RPC `change_parent_pin` (uses profiles.parent_pin only).
 */
export async function changeParentPin(
  userId: string,
  currentPin: string,
  newPin: string,
): Promise<ChangeParentPinResult> {
  const currentDigits = currentPin.replace(/\D/g, '')
  const newDigits = newPin.replace(/\D/g, '')

  if (!userId.trim()) {
    return { ok: false, message: 'יש להתחבר מחדש' }
  }

  if (!isValidParentPinDigits(newDigits)) {
    return { ok: false, message: 'הקוד החדש חייב להכיל בין 4 ל-6 ספרות' }
  }

  const { data, error } = await supabase.rpc('change_parent_pin', {
    p_current_pin: currentDigits,
    p_new_pin: newDigits,
  })

  if (error) {
    const msg = error.message || ''
    if (/change_parent_pin/i.test(msg) && /not find|does not exist|42883/i.test(msg)) {
      return changeViaDirectUpdate(userId, currentDigits, newDigits)
    }
    if (/access_code does not exist/i.test(msg)) {
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 027_parent_pin_fix.sql',
      }
    }
    if (msg.includes('parent_pin_update_not_allowed')) {
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 027_parent_pin_fix.sql',
      }
    }
    return { ok: false, message: msg || 'עדכון הקוד נכשל' }
  }

  const result = parseRpcResult(data)
  if (!result.ok && result.message === 'עדכון הקוד נכשל') {
    return changeViaDirectUpdate(userId, currentDigits, newDigits)
  }
  return result
}
