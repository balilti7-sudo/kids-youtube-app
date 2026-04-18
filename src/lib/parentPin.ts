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
