/**
 * In-memory parent PIN for the current browser tab only.
 * Used to re-verify sensitive mutations after the management gate unlocks.
 * Never persisted to localStorage / sessionStorage.
 */

import { isParentalManagementGateUnlocked } from './parentalManagementGateStorage'

let sessionPin = ''

export function setParentPinSession(pin: string): void {
  sessionPin = pin.replace(/\D/g, '').trim()
}

export function getParentPinSession(): string {
  return sessionPin
}

export function clearParentPinSession(): void {
  sessionPin = ''
}

/** Gate unlocked or PIN already entered this tab — skip slow verify_parent_pin RPC. */
export function isParentManagementSessionVerified(): boolean {
  if (isParentalManagementGateUnlocked()) return true
  return getParentPinSession().replace(/\D/g, '').length >= 6
}
