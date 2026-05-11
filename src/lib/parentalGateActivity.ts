import { SAFETUBE_PARENTAL_GATE_ACTIVITY_KEY } from './safetubeSessionKeys'

/** נעילה אוטומטית אחרי חוסר פעילות באזור ההורה (דקות ספורות > סגירת טאב). */
export const PARENTAL_GATE_IDLE_LOCK_MS = 3 * 60 * 1000

export function touchParentalGateActivity(): void {
  try {
    sessionStorage.setItem(SAFETUBE_PARENTAL_GATE_ACTIVITY_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export function clearParentalGateActivity(): void {
  try {
    sessionStorage.removeItem(SAFETUBE_PARENTAL_GATE_ACTIVITY_KEY)
  } catch {
    /* ignore */
  }
}

export function isParentalGateIdleExceeded(): boolean {
  try {
    const raw = sessionStorage.getItem(SAFETUBE_PARENTAL_GATE_ACTIVITY_KEY)
    if (!raw) return false
    const t = Number(raw)
    if (!Number.isFinite(t)) return false
    return Date.now() - t > PARENTAL_GATE_IDLE_LOCK_MS
  } catch {
    return false
  }
}
