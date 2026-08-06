import { isValidParentPinDigits } from './parentPin'
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

/**
 * Change parent PIN via Supabase RPC `change_parent_pin` only.
 * Direct table UPDATE is no longer used (plaintext PIN writes are blocked by migration 068).
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
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 068_parent_pin_hash_and_verify.sql',
      }
    }
    if (msg.includes('parent_pin_update_not_allowed')) {
      return {
        ok: false,
        message: 'הריצו ב-Supabase את המיגרציה 068_parent_pin_hash_and_verify.sql',
      }
    }
    return { ok: false, message: msg || 'עדכון הקוד נכשל' }
  }

  return parseRpcResult(data)
}
