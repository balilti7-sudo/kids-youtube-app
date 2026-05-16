import {
  isValidParentPinDigits,
  pinsMatch,
  resolvedManagementPinFromProfileRow,
} from './parentPin'
import { supabase } from './supabase'

export type ChangeParentPinResult = { ok: true } | { ok: false; message: string }

const WRONG_CURRENT_PIN_HE = 'קוד PIN נוכחי שגוי'

function profileHasConfiguredPin(row: { parent_pin?: unknown; access_code?: unknown }): boolean {
  const stored = resolvedManagementPinFromProfileRow(row)
  return stored.length >= 4 && stored !== '0000'
}

/**
 * Change parent PIN via direct profiles SELECT + compare + UPDATE (no RPC).
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

  const { data, error: selectError } = await supabase
    .from('profiles')
    .select('parent_pin, access_code')
    .eq('id', userId)
    .maybeSingle()

  if (selectError) {
    return { ok: false, message: selectError.message || 'לא ניתן לטעון את הקוד הנוכחי' }
  }

  if (!data) {
    return { ok: false, message: 'פרופיל לא נמצא' }
  }

  const pinConfigured = profileHasConfiguredPin(data)

  if (pinConfigured) {
    if (!isValidParentPinDigits(currentDigits)) {
      return { ok: false, message: 'נא להזין את קוד PIN הנוכחי' }
    }

    const stored = resolvedManagementPinFromProfileRow(data)
    if (!pinsMatch(currentDigits, stored)) {
      return { ok: false, message: WRONG_CURRENT_PIN_HE }
    }
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ parent_pin: newDigits })
    .eq('id', userId)

  if (updateError) {
    if (
      updateError.code === '42501' ||
      updateError.message?.includes('parent_pin_update_not_allowed')
    ) {
      return {
        ok: false,
        message:
          'עדכון הקוד נחסם בשרת. אם הופעלה מיגרציית אבטחה ישנה — הסירו את הטריגר או הריצו את המיגרציה לביטולו.',
      }
    }
    return { ok: false, message: updateError.message || 'עדכון הקוד נכשל' }
  }

  return { ok: true }
}
