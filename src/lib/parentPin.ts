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

/** קוד הורה במסד ובטפסים: 4–6 ספרות. */
export const PARENT_PIN_DIGIT_MIN = 4
export const PARENT_PIN_DIGIT_MAX = 6

export function isValidParentPinDigits(raw: string): boolean {
  const d = raw.replace(/\D/g, '')
  return /^\d+$/.test(d) && d.length >= PARENT_PIN_DIGIT_MIN && d.length <= PARENT_PIN_DIGIT_MAX
}

/** PIN רציף משדות ספרה בודדות (עוצרים במקום הריק הראשון). */
export function contiguousDigitsFromPinSlots(slots: readonly ('' | string)[]): string {
  let s = ''
  for (const x of slots) {
    if (x === '' || x == null) break
    s += x
  }
  return s
}

/** השוואת PIN אחרי ניקוי רווחים מיותרים (מקלדות במובייל) */
export function pinsMatch(input: string, expected: string): boolean {
  const a = input.replace(/\s+/g, '').trim()
  const b = expected.replace(/\s+/g, '').trim()
  return a === b
}

const normPin = (s: string | null | undefined) => (typeof s === 'string' ? s.replace(/\s+/g, '').trim() : '')

function stringifyPinRaw(raw: unknown): string {
  if (raw == null) return ''
  return String(raw).replace(/\s+/g, '').trim()
}

/** בוחר קוד ניהול ממסד: `parent_pin` במקום הראשון, אחר כך `access_code` (אם קיים בפרופיל). */
export function resolvedManagementPinFromProfileRow(row: {
  parent_pin?: unknown
  access_code?: unknown
}): string {
  const pp = stringifyPinRaw(row.parent_pin)
  const ac = stringifyPinRaw(row.access_code)
  if (pp.length >= 4 && pp !== '0000') return pp
  if (ac.length >= 4 && ac !== '0000') return ac
  if (pp.length >= 4) return pp
  if (ac.length >= 4) return ac
  return ''
}

/**
 * קוד לאימות הוספת/מחיקת ערוץ: קודם `profiles.parent_pin`, אחרת PIN של ניהול מקומי במכשיר הילד, ואז משתני סביבה (פיתוח / תאימות).
 */
export function getExpectedChannelActionPin(
  profile: Profile | null | undefined,
  localParent: { isActive: boolean; pin?: string | null }
): string {
  const fromProfile = resolvedManagementPinFromProfileRow({
    parent_pin: profile?.parent_pin,
    access_code: profile?.access_code,
  })
  if (fromProfile.length >= 4) return fromProfile

  if (localParent.isActive) {
    const lp = normPin(localParent.pin)
    if (lp.length > 0) return lp
  }

  return getResolvedParentPin()
}

const normAccess = (s: string | null | undefined) =>
  typeof s === 'string' ? s.replace(/\s+/g, '').trim() : ''

function hasUsableMgmtCode(s: string): boolean {
  return s.length >= 4 && s !== '0000'
}

/** true כשאין במסך הפרופיל קוד הורה שמיש (מ-`parent_pin` או `access_code`). */
export function isProfileParentPinMissing(profile: Profile | null | undefined): boolean {
  const pin = normPin(profile?.parent_pin)
  const ac = normAccess(profile?.access_code)
  return !hasUsableMgmtCode(pin) && !hasUsableMgmtCode(ac)
}
