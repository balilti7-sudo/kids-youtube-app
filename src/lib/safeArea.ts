/**
 * Safe-area CSS variables for edge-to-edge Android (targetSdk 35+) and iOS.
 * Native MainActivity overrides --sat/--sab/--sal/--sar from WindowInsets.
 */
import { Capacitor } from '@capacitor/core'

/** Minimum bottom inset when env() reports 0 (common in Android WebView). */
const ANDROID_MIN_BOTTOM_PX = 24

export function initSafeAreaInsets(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  if (Capacitor.isNativePlatform()) {
    root.classList.add('capacitor-native')
    if (Capacitor.getPlatform() === 'android') {
      root.classList.add('capacitor-android')
      // Seed until MainActivity WindowInsets arrive (env() is often 0 in WebView).
      if (!root.style.getPropertyValue('--sab')) {
        root.style.setProperty('--sab', `${ANDROID_MIN_BOTTOM_PX}px`)
      }
    }
  }
}

/** Called from Android MainActivity via evaluateJavascript with pixel insets. */
export function applyNativeSafeAreaInsets(top: number, bottom: number, left: number, right: number): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const b = Math.max(bottom, Capacitor.getPlatform() === 'android' ? ANDROID_MIN_BOTTOM_PX : 0)
  root.style.setProperty('--sat', `${Math.max(0, top)}px`)
  root.style.setProperty('--sab', `${b}px`)
  root.style.setProperty('--sal', `${Math.max(0, left)}px`)
  root.style.setProperty('--sar', `${Math.max(0, right)}px`)
}

declare global {
  interface Window {
    __safetubeApplySafeArea?: typeof applyNativeSafeAreaInsets
  }
}

if (typeof window !== 'undefined') {
  window.__safetubeApplySafeArea = applyNativeSafeAreaInsets
}
