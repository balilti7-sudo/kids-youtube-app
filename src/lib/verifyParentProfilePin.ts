import { supabase } from './supabase'
import { pinsMatch } from './parentPin'

export type ParentPinVerifyResult = { ok: true } | { ok: false; errorMessage: string }

/** אימות מול `profiles.parent_pin` למשתמש מחובר (קריאה טרייה מה-DB). */
export async function verifyLoggedInUserParentPin(userId: string, pin: string): Promise<ParentPinVerifyResult> {
  const trimmed = pin.replace(/\D/g, '').trim()
  if (trimmed.length !== 4) {
    return { ok: false, errorMessage: 'נא להזין 4 ספרות' }
  }

  const { data, error } = await supabase.from('profiles').select('parent_pin').eq('id', userId).maybeSingle()

  if (error) {
    return { ok: false, errorMessage: 'לא ניתן לאמת כרגע, נסו שוב' }
  }

  const stored = data?.parent_pin != null ? String(data.parent_pin).replace(/\s+/g, '').trim() : ''
  const expected = stored.length > 0 ? stored : '0000'

  if (!pinsMatch(trimmed, expected)) {
    return { ok: false, errorMessage: 'קוד שגוי' }
  }

  return { ok: true }
}
