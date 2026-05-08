/** One-shot skip של מסך קוד ההורה (למשל אחרי התחברות / אימות מייל / הגדרת PIN ראשונית). */

export const SKIP_PARENTAL_MANAGEMENT_GATE_KEY = 'safetube_skip_management_gate_once'
export const SKIP_PARENTAL_MANAGEMENT_GATE_MAX_AGE_MS = 30 * 60 * 1000

export function setSkipParentalManagementGateOnce(): void {
  try {
    sessionStorage.setItem(SKIP_PARENTAL_MANAGEMENT_GATE_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** קוראים פעם אחת בהתחלה של 레אאוט ההורה; מחזיר true אם היה דגל תקף ונמחק. */
export function consumeSkipParentalManagementGateOnce(): boolean {
  try {
    const raw = sessionStorage.getItem(SKIP_PARENTAL_MANAGEMENT_GATE_KEY)
    if (!raw) return false
    const t = Number(raw)
    if (!Number.isFinite(t) || Date.now() - t > SKIP_PARENTAL_MANAGEMENT_GATE_MAX_AGE_MS) {
      sessionStorage.removeItem(SKIP_PARENTAL_MANAGEMENT_GATE_KEY)
      return false
    }
    sessionStorage.removeItem(SKIP_PARENTAL_MANAGEMENT_GATE_KEY)
    return true
  } catch {
    return false
  }
}
