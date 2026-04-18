/** מחלץ `code` מתוך `location.search` (?code=123456) — לניתוב מ־/ או /auth למסך ילד */
export function parsePairingCodeFromLocationSearch(search: string): string | null {
  try {
    const code = new URLSearchParams(search || '').get('code')?.trim()
    if (code && /^\d{6}$/.test(code)) return code
  } catch {
    /* ignore */
  }
  return null
}

/** מחלץ קוד צימוד של 6 ספרות מטקסט QR — קישור עם ?code= או רק המספרים */
export function parsePairingCodeFromScan(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const u = new URL(trimmed)
    const c = u.searchParams.get('code')?.trim()
    if (c && /^\d{6}$/.test(c)) return c
  } catch {
    // לא URL מלא
  }

  const fromQuery = trimmed.match(/[?&]code=(\d{6})(?:\b|&|#|$)/i)
  if (fromQuery?.[1]) return fromQuery[1]

  const digitsOnly = trimmed.replace(/\D/g, '')
  if (digitsOnly.length === 6) return digitsOnly

  return null
}
