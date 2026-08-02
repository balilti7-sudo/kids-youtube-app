/**
 * Thin Capacitor plugin wrapper for the Android MediaPlayback foreground service.
 * Keeps the process alive (and the WebView media playing) when the screen is off
 * or the user switches to Waze / WhatsApp.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

export interface MediaPlaybackPlugin {
  start(options?: { title?: string; artist?: string }): Promise<void>
  stop(): Promise<void>
}

const MediaPlayback = registerPlugin<MediaPlaybackPlugin>('MediaPlayback', {
  web: () => ({
    async start() {
      /* no-op on web — browser handles background media itself */
    },
    async stop() {
      /* no-op */
    },
  }),
})

export async function startNativeMediaPlayback(opts?: {
  title?: string
  artist?: string
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await MediaPlayback.start({
      title: opts?.title || 'SafeTube',
      artist: opts?.artist || 'מתנגן עכשיו',
    })
  } catch (err) {
    console.warn('[mediaPlayback] start failed', err)
  }
}

export async function stopNativeMediaPlayback(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await MediaPlayback.stop()
  } catch (err) {
    console.warn('[mediaPlayback] stop failed', err)
  }
}
