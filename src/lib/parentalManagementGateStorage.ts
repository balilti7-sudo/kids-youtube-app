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
}

export function clearParentalManagementGate(): void {
  try {
    sessionStorage.removeItem(SAFETUBE_PARENTAL_MANAGEMENT_GATE_KEY)
  } catch {
    /* ignore */
  }
}
