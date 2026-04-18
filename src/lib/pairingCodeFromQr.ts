/** מחלץ `code` מ־`location.search` ואז מ־`location.hash` (?code= / #code=) */
export function parsePairingCodeFromLocationSearch(search: string, hash = ''): string | null {
  try {
    const code = new URLSearchParams(search || '').get('code')?.trim()
    if (code && /^\d{6}$/.test(code)) return code
  } catch {
    /* ignore */
  }
  const fromHash = hash.match(/[?&#]code=(\d{6})(?:\b|&|#|$)/i) ?? hash.match(/code[=:](\d{6})/i)
  if (fromHash?.[1]) return fromHash[1]
  return null
}

/**
 * לפני React Router: אם יש קוד צימוד בכתובת אך לא ב־/kid — מעבירים את ה־URL ל־/kid?code=
 * (PWA עם start_url=/ , או סורק שמחזיר /?code= במקום /kid?code=)
 */
export function normalizePairingUrlInAddressBar(): void {
  if (typeof window === 'undefined') return
  try {
    const code = parsePairingCodeFromLocationSearch(window.location.search, window.location.hash)
    // eslint-disable-next-line no-console -- דיבוג זמני לפי דרישת מוצר
    console.log('Detected code in URL: ' + (code ?? '(none)'))
    if (code && !window.location.pathname.startsWith('/kid')) {
      const nextPath = `/kid?code=${encodeURIComponent(code)}`
      window.history.replaceState({}, document.title, nextPath)
    }
  } catch {
    // eslint-disable-next-line no-console -- דיבוג זמני לפי דרישת מוצר
    console.log('Detected code in URL: (none)')
  }
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
