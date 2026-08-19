import { Capacitor, registerPlugin } from '@capacitor/core'

interface ChildDisplayPlugin {
  setHideThumbnails(opts: { hide: boolean }): Promise<void>
}

const ChildDisplay = registerPlugin<ChildDisplayPlugin>('ChildDisplay', {
  web: () => ({
    async setHideThumbnails() {
      /* no-op on web */
    },
  }),
})

export function isChildDisplayNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function syncChildDisplayPrefs(opts: { hideThumbnails: boolean }): Promise<void> {
  if (!isChildDisplayNativeAvailable()) return
  try {
    await ChildDisplay.setHideThumbnails({ hide: Boolean(opts.hideThumbnails) })
  } catch (err) {
    console.warn('[childDisplay] setHideThumbnails failed', err)
  }
}
