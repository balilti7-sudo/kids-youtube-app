/**
 * דגל חד-פעמי: הורה בכוונה פתח נתיב ניהול (לחיצה ארוכה / אחרי PIN במסך ילדים),
 * כדי לא לחסום אותו בזמן שמנגנון האבטחה מפנה ילדים שמקלידים URL ידנית.
 */
const KEY = 'safetube_parent_entry_intent_v1'
const MAX_AGE_MS = 20_000

export function setParentEntryIntent(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** מחזיר true אם היה דגל תקף ומסיר אותו. */
export function consumeParentEntryIntent(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return false
    sessionStorage.removeItem(KEY)
    const t = Number(raw)
    if (!Number.isFinite(t) || Date.now() - t > MAX_AGE_MS) return false
    return true
  } catch {
    return false
  }
}
