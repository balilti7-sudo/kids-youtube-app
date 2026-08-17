import { isParentalGateIdleExceeded, touchParentalGateActivity } from './parentalGateActivity'
import { clearParentPinSession, getParentPinSession } from './parentPinSession'
import { SAFETUBE_PARENTAL_MANAGEMENT_GATE_KEY } from './safetubeSessionKeys'

export function isParentalManagementGateUnlocked(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SAFETUBE_PARENTAL_MANAGEMENT_GATE_KEY) === '1'
  } catch {
    return false
  }
}

export function setParentalManagementGateUnlocked(): void {
  try {
    sessionStorage.setItem(SAFETUBE_PARENTAL_MANAGEMENT_GATE_KEY, '1')
  } catch {
    /* ignore */
  }
  touchParentalGateActivity()
}

export function clearParentalManagementGate(): void {
  clearParentPinSession()
  try {
    sessionStorage.removeItem(SAFETUBE_PARENTAL_MANAGEMENT_GATE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * True while the parent PIN session is still valid: gate unlocked, not idle past
 * 10 minutes, and (when a PIN exists) the in-memory PIN is still present.
 */
export function isParentUnlockSessionActive(): boolean {
  if (!isParentalManagementGateUnlocked()) return false
  if (isParentalGateIdleExceeded()) return false
  return true
}

/** PIN already verified this session — skip extra prompts and extra verify RPCs. */
export function hasVerifiedParentPinForMutations(): boolean {
  if (!isParentUnlockSessionActive()) return false
  return getParentPinSession().length >= 4
}
