import { Capacitor, registerPlugin } from '@capacitor/core'
import { secureGet, secureRemove, secureSet } from './secureStorage'

interface BiometricUnlockPlugin {
  isAvailable(): Promise<{ available: boolean }>
  authenticate(options?: { title?: string; subtitle?: string }): Promise<void>
}

const NativeBiometric = registerPlugin<BiometricUnlockPlugin>('BiometricUnlock')

const BIOMETRIC_ENABLED_KEY = 'safetube_biometric_parent_enabled'
const BIOMETRIC_PIN_KEY = 'parent_pin_biometric'

export function isBiometricUnlockSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function isBiometricUnlockEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(BIOMETRIC_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export async function checkBiometricHardwareAvailable(): Promise<boolean> {
  if (!isBiometricUnlockSupported()) return false
  try {
    const { available } = await NativeBiometric.isAvailable()
    return available
  } catch {
    return false
  }
}

/** Save PIN for quick unlock after a successful PIN verification. */
export async function enrollBiometricParentPin(pin: string): Promise<boolean> {
  const trimmed = pin.replace(/\D/g, '').trim()
  if (trimmed.length !== 6) return false
  const hardware = await checkBiometricHardwareAvailable()
  if (!hardware) return false
  await secureSet(BIOMETRIC_PIN_KEY, trimmed)
  try {
    window.localStorage.setItem(BIOMETRIC_ENABLED_KEY, '1')
  } catch {
    /* ignore */
  }
  return true
}

export async function disableBiometricUnlock(): Promise<void> {
  await secureRemove(BIOMETRIC_PIN_KEY)
  try {
    window.localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
  } catch {
    /* ignore */
  }
}

/** Prompt fingerprint / face — returns stored parent PIN on success. */
export async function tryBiometricParentUnlock(): Promise<string | null> {
  if (!isBiometricUnlockEnabled()) return null
  if (!isBiometricUnlockSupported()) return null
  const stored = await secureGet(BIOMETRIC_PIN_KEY)
  if (!stored) return null
  try {
    await NativeBiometric.authenticate({
      title: 'כניסה לבקרת הורים',
      subtitle: 'השתמשו בטביעת אצבע',
    })
    return stored.replace(/\D/g, '').trim()
  } catch {
    return null
  }
}
