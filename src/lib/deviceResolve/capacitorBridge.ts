/**
 * Installs the `window.safetube` bridge when running inside the Capacitor native app.
 *
 * Unlike Electron (where the bridge is injected by a preload script), under Capacitor the
 * resolver runs in the WebView itself, so we register the bridge from app code at startup.
 * The resolver module is imported lazily so youtubei.js/bgutils-js never load (or cost
 * bundle-parse time) in the plain web build.
 */
import { Capacitor } from '@capacitor/core'
import type { SafetubeNativeBridge } from './index'

export function initCapacitorDeviceResolve(): void {
  if (typeof window === 'undefined') return
  if (window.safetube) return // e.g. Electron preload already installed a bridge
  if (!Capacitor.isNativePlatform()) return

  const bridge: SafetubeNativeBridge = {
    platform: 'capacitor',
    async resolve(videoId, quality) {
      const { resolveWebviewStream } = await import('./webviewResolver')
      return resolveWebviewStream(videoId, quality)
    },
  }
  window.safetube = bridge
  console.log('[safetube] Capacitor on-device resolver registered')

  // Pre-build the BotGuard/PO-token session in the background so the first
  // video doesn't pay the ~2-5s session setup cost.
  void import('./webviewResolver').then(({ warmupWebviewResolver }) => warmupWebviewResolver())
}
