/**
 * In-memory parent PIN for the current browser tab only.
 * Used to re-verify sensitive mutations after the management gate unlocks.
 * Never persisted to localStorage / sessionStorage.
 */

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
