/**
 * Capacitor bridge for on-device parental controls (YouTube app block + browser whitelist).
 * Enforced by Android AccessibilityService — requires the parent to enable the service once.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export type ParentalControlPolicy = {
  blockYoutube: boolean
  browserFilterEnabled: boolean
  whitelist: string[]
}

export type ParentalControlStatus = ParentalControlPolicy & {
  accessibilityEnabled: boolean
}

interface ParentalControlPlugin {
  getStatus(): Promise<ParentalControlStatus>
  openAccessibilitySettings(): Promise<void>
  applyPolicy(policy: ParentalControlPolicy): Promise<{ ok: boolean; accessibilityEnabled: boolean }>
  allowBrowserBypass(opts?: { durationMs?: number }): Promise<{ ok: boolean; until?: number }>
  clearBrowserBypass(): Promise<{ ok: boolean }>
}

const ParentalControl = registerPlugin<ParentalControlPlugin>('ParentalControl', {
  web: () => ({
    async getStatus() {
      return {
        accessibilityEnabled: false,
        blockYoutube: false,
        browserFilterEnabled: false,
        whitelist: [],
      }
    },
    async openAccessibilitySettings() {
      /* no-op on web */
    },
    async applyPolicy() {
      return { ok: true, accessibilityEnabled: false }
    },
    async allowBrowserBypass() {
      return { ok: true }
    },
    async clearBrowserBypass() {
      return { ok: true }
    },
  }),
})

export function isParentalControlNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function getParentalControlStatus(): Promise<ParentalControlStatus> {
  if (!isParentalControlNativeAvailable()) {
    return {
      accessibilityEnabled: false,
      blockYoutube: false,
      browserFilterEnabled: false,
      whitelist: [],
    }
  }
  try {
    return await ParentalControl.getStatus()
  } catch {
    return {
      accessibilityEnabled: false,
      blockYoutube: false,
      browserFilterEnabled: false,
      whitelist: [],
    }
  }
}

export async function openParentalControlAccessibilitySettings(): Promise<void> {
  if (!isParentalControlNativeAvailable()) return
  try {
    await ParentalControl.openAccessibilitySettings()
  } catch (err) {
    console.warn('[parentalControl] openAccessibilitySettings failed', err)
  }
}

export async function applyParentalControlPolicy(policy: ParentalControlPolicy): Promise<{
  accessibilityEnabled: boolean
}> {
  if (!isParentalControlNativeAvailable()) {
    return { accessibilityEnabled: false }
  }
  try {
    const res = await ParentalControl.applyPolicy({
      blockYoutube: Boolean(policy.blockYoutube),
      browserFilterEnabled: Boolean(policy.browserFilterEnabled),
      whitelist: Array.isArray(policy.whitelist) ? policy.whitelist.map(normalizeWhitelistHost).filter(Boolean) : [],
    })
    return { accessibilityEnabled: Boolean(res.accessibilityEnabled) }
  } catch (err) {
    console.warn('[parentalControl] applyPolicy failed', err)
    return { accessibilityEnabled: false }
  }
}

/** Skip site-filter while SafeTube opens a system browser (OAuth Custom Tab). */
export async function allowParentalControlBrowserBypass(durationMs = 180_000): Promise<void> {
  if (!isParentalControlNativeAvailable()) return
  try {
    await ParentalControl.allowBrowserBypass({ durationMs })
  } catch (err) {
    console.warn('[parentalControl] allowBrowserBypass failed', err)
  }
}

export async function clearParentalControlBrowserBypass(): Promise<void> {
  if (!isParentalControlNativeAvailable()) return
  try {
    await ParentalControl.clearBrowserBypass()
  } catch (err) {
    console.warn('[parentalControl] clearBrowserBypass failed', err)
  }
}

/** Normalize parent-entered URL/host to a bare hostname. */
export function normalizeWhitelistHost(input: string): string {
  let s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\//, '')
  const slash = s.indexOf('/')
  if (slash >= 0) s = s.slice(0, slash)
  const q = s.indexOf('?')
  if (q >= 0) s = s.slice(0, q)
  if (s.startsWith('www.')) s = s.slice(4)
  const colon = s.indexOf(':')
  if (colon > 0) s = s.slice(0, colon)
  while (s.endsWith('.')) s = s.slice(0, -1)
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(s) && s !== 'localhost') return ''
  return s
}
