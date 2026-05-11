import { clearLocalParentSession } from './localParentAdmin'
import { clearParentalGateActivity } from './parentalGateActivity'
import { clearParentalManagementGate } from './parentalManagementGateStorage'
import { SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY } from './safetubeSessionKeys'
import { setAppModeKid } from './appMode'

/** נשלח אחרי ניקוי session — `AppLayout` מאזין ומחזיר את שער הניהול */
export const LOCK_MANAGEMENT_APP_EVENT = 'safetube-lock-management-app'

/** מוחק את כל אחסון ה-PIN הרלוונטי לסשן הנוכחי (שער ניהול, הורה מקומי, ביטול נעילה במסך ילד). */
export function clearParentPinSessions(): void {
  clearParentalManagementGate()
  clearParentalGateActivity()
  clearLocalParentSession()
  try {
    window.sessionStorage.removeItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
  } catch {
    /* ignore */
  }
}

/** נעילה מיידית: ניקוי PIN + מצב אפליקציה ילד + אירוע לריענון שער הניהול. */
export function lockManagementAppShell(): void {
  clearParentPinSessions()
  setAppModeKid()
  try {
    window.dispatchEvent(new CustomEvent(LOCK_MANAGEMENT_APP_EVENT))
  } catch {
    /* ignore */
  }
}
