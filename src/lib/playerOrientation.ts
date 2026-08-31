/**
 * Player theater orientation — layout only.
 * Android: Activity lock via existing MediaPlayback plugin (WebView lock is unreliable).
 * Web: best-effort Screen Orientation API.
 */
import { Capacitor } from '@capacitor/core'
import { setNativeOrientationLock } from './nativeMediaPlayback'

export type PlayerOrientationMode = 'landscape' | 'portrait' | 'unlocked'

let lastRequestedMode: PlayerOrientationMode = 'unlocked'

/** Last orientation mode we asked for (not necessarily what the device applied). */
export function getPlayerOrientationLock(): PlayerOrientationMode {
  return lastRequestedMode
}

export async function lockPlayerOrientation(mode: PlayerOrientationMode): Promise<void> {
  lastRequestedMode = mode

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await setNativeOrientationLock(mode)
      return
    } catch {
      /* fall through to web API */
    }
  }

  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (type: string) => Promise<void>
    }
    if (mode === 'unlocked') {
      orientation.unlock?.()
      return
    }
    await orientation.lock?.(mode)
  } catch {
    /* WebView / desktop may deny — fullscreen still proceeds */
  }
}

/** Best-effort unlock after exit / recovery — never throws. */
export async function unlockPlayerOrientationSafe(): Promise<void> {
  try {
    await lockPlayerOrientation('unlocked')
  } catch {
    lastRequestedMode = 'unlocked'
  }
}
