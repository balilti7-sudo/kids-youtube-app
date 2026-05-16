import { supabase } from './supabase'

const ERROR_HE: Record<string, string> = {
  not_authenticated: 'יש להתחבר מחדש',
  profile_not_found: 'פרופיל לא נמצא',
  wrong_current_pin: 'קוד PIN נוכחי שגוי',
  current_pin_required: 'נא להזין את קוד PIN הנוכחי',
  pin_too_short: 'הקוד החדש קצר מדי (מינימום 4 ספרות)',
  pin_too_long: 'הקוד החדש ארוך מדי (מקסימום 6 ספרות)',
  pin_not_numeric: 'הקוד חייב להכיל ספרות בלבד',
  parent_pin_update_not_allowed: 'לא ניתן לעדכן את הקוד בדרך זו. נסו שוב מהמסך.',
}

export type ChangeParentPinResult = { ok: true } | { ok: false; message: string }

export async function changeParentPin(
  currentPin: string,
  newPin: string,
): Promise<ChangeParentPinResult> {
  const { data, error } = await supabase.rpc('change_parent_pin', {
    p_current_pin: currentPin.replace(/\D/g, ''),
    p_new_pin: newPin.replace(/\D/g, ''),
  })

  if (error) {
    const code = (error as { code?: string }).code
    if (code === '42501' || error.message?.includes('parent_pin_update_not_allowed')) {
      return { ok: false, message: ERROR_HE.parent_pin_update_not_allowed }
    }
    return { ok: false, message: error.message || 'עדכון הקוד נכשל' }
  }

  const row = data as { ok?: boolean; error?: string } | null
  if (!row?.ok) {
    const key = typeof row?.error === 'string' ? row.error : ''
    return { ok: false, message: ERROR_HE[key] ?? 'עדכון הקוד נכשל' }
  }

  return { ok: true }
}
