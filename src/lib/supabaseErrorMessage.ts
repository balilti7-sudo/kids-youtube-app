/**
 * Turn raw Supabase / Capacitor / fetch errors into short Hebrew for toasts.
 */
export function humanizeSupabaseError(raw: string | undefined | null): string {
  const msg = (raw ?? '').trim().replace(/^Error:\s*/i, '')
  if (!msg) return 'אירעה שגיאה. נסו שוב.'

  const lower = msg.toLowerCase()

  if (
    lower.includes('failed to connect') ||
    lower.includes('network error') ||
    lower.includes('network request failed') ||
    lower.includes('unable to resolve host') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    (lower.includes('supabase.co') && /:\d{3}/.test(msg))
  ) {
    return 'אין חיבור לשרת. בדקו Wi‑Fi או סלולר, כבו VPN/חוסם פרסומות, ונסו שוב.'
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('error code: 522') ||
    lower.includes('error code: 523') ||
    lower.includes('error code: 504') ||
    lower.includes('error code: 502')
  ) {
    return 'השרת לא הגיב בזמן. נסו שוב בעוד כמה שניות.'
  }

  if (lower.includes('failed to fetch') || lower.includes('load failed')) {
    return 'לא ניתן לפנות לשרת. בדקו את החיבור לאינטרנט.'
  }

  if (lower.includes('jwt') || lower.includes('auth') || lower.includes('not authenticated')) {
    return 'ההתחברות פגה. התחברו מחדש ונסו שוב.'
  }

  return msg
}
