import type { Profile } from '../types'

/**
 * אותה לוגיקה בכל האפליקציה — PIN להגדרות הורה (ערוצים) ולניתוק במסך הילד.
 * מחרוזות ריקות (כולל אחרי trim) לא נחשבות — אז חוזרים ל־1234.
 */
export function getResolvedParentPin(): string {
  const m = import.meta.env.VITE_PARENT_MANAGEMENT_PIN
  const u = import.meta.env.VITE_PARENT_UNLOCK_PIN
  const mt = typeof m === 'string' ? m.trim() : ''
  const ut = typeof u === 'string' ? u.trim() : ''
  if (mt.length > 0) return mt
  if (ut.length > 0) return ut
  return '1234'
}

/** השוואת PIN אחרי ניקוי רווחים מיותרים (מקלדות במובייל) */
export function pinsMatch(input: string, expected: string): boolean {
  const a = input.replace(/\s+/g, '').trim()
  const b = expected.replace(/\s+/g, '').trim()
  return a === b
}

const normPin = (s: string | null | undefined) => (typeof s === 'string' ? s.replace(/\s+/g, '').trim() : '')

/**
 * קוד לאימות הוספת/מחיקת ערוץ: קודם `profiles.parent_pin`, אחרת PIN של ניהול מקומי במכשיר הילד, ואז משתני סביבה (פיתוח / תאימות).
 */
export function getExpectedChannelActionPin(
  profile: Profile | null | undefined,
  localParent: { isActive: boolean; pin?: string | null }
): string {
  const fromProfile = normPin(profile?.parent_pin)
  if (fromProfile.length > 0) return fromProfile

  if (localParent.isActive) {
    const lp = normPin(localParent.pin)
    if (lp.length > 0) return lp
  }

  return getResolvedParentPin()
}

/** true כשהמשתמש חייב להגדיר PIN (null/empty/0000/קצר מ-4) לפני כניסה לניהול. */
export function isProfileParentPinMissing(profile: Profile | null | undefined): boolean {
  const pin = normPin(profile?.parent_pin)
  return pin.length < 4 || pin === '0000'
}
