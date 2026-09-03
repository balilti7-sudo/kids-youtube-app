/**
 * Capacitor bridge for Android MediaSession + foreground media service.
 * Exposes transport events from Bluetooth / Android Auto / lock screen / notification
 * into the WebView player (play, pause, next, previous, seek). Hardware volume is
 * handled natively on STREAM_MUSIC so steering-wheel volume stays hands-free.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type NativeMediaAction =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seekto'
  | 'seekforward'
  | 'seekbackward'

export type NativeMediaActionEvent = {
  action: NativeMediaAction | string
  seekToMs?: number
}

export type NativeMediaSessionUpdate = {
  title?: string
  artist?: string
  durationMs?: number
  positionMs?: number
  playing?: boolean
  artworkUrl?: string | null
  canSkipNext?: boolean
  canSkipPrev?: boolean
}

export type NativeOrientationLockMode = 'landscape' | 'portrait' | 'unlocked'

/** Returned by Android setOrientationLock when mode is portrait (Configuration wait). */
export type NativeOrientationLockResult = {
  applied?: boolean
  orientation?: string
  attempts?: number
  timedOut?: boolean
}

export interface MediaPlaybackPlugin {
  start(options?: NativeMediaSessionUpdate): Promise<void>
  updateSession(options: NativeMediaSessionUpdate): Promise<void>
  stop(): Promise<void>
  adjustVolume(options: { direction: 'raise' | 'lower' | 'mute' | 'toggleMute' }): Promise<void>
  /** Fullscreen theater — Activity orientation lock (layout only). */
  setOrientationLock(options: {
    mode: NativeOrientationLockMode
  }): Promise<NativeOrientationLockResult | void>
  addListener(
    eventName: 'mediaAction',
    listenerFunc: (event: NativeMediaActionEvent) => void
  ): Promise<PluginListenerHandle>
}

const MediaPlayback = registerPlugin<MediaPlaybackPlugin>('MediaPlayback', {
  web: () => ({
    async start() {
      /* no-op on web */
    },
    async updateSession() {
      /* no-op on web */
    },
    async stop() {
      /* no-op */
    },
    async adjustVolume() {
      /* no-op on web — use HTMLMediaElement.volume */
    },
    async setOrientationLock() {
      /* no-op on web — use Screen Orientation API via playerOrientation */
    },
    async addListener() {
      return { remove: async () => undefined }
    },
  }),
})

type MediaActionHandler = (event: NativeMediaActionEvent) => void

const actionHandlers = new Set<MediaActionHandler>()
let nativeListener: PluginListenerHandle | null = null
let nativeListenerPromise: Promise<void> | null = null

function dispatchMediaAction(event: NativeMediaActionEvent) {
  for (const handler of actionHandlers) {
    try {
      handler(event)
    } catch (err) {
      console.warn('[mediaPlayback] action handler failed', err)
    }
  }
}

/** Global fallback used by native evaluateJavascript when Capacitor listeners are cold. */
if (typeof window !== 'undefined') {
  ;(window as unknown as { __safetubeMediaAction?: (d: NativeMediaActionEvent) => void }).__safetubeMediaAction =
    (d) => {
      if (!d || typeof d.action !== 'string') return
      dispatchMediaAction(d)
    }
}

async function ensureNativeListener(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  if (nativeListener) return
  if (nativeListenerPromise) return nativeListenerPromise
  nativeListenerPromise = (async () => {
    try {
      nativeListener = await MediaPlayback.addListener('mediaAction', (event) => {
        dispatchMediaAction(event)
      })
    } catch (err) {
      console.warn('[mediaPlayback] addListener failed', err)
    } finally {
      nativeListenerPromise = null
    }
  })()
  return nativeListenerPromise
}

export function subscribeNativeMediaActions(handler: MediaActionHandler): () => void {
  actionHandlers.add(handler)
  void ensureNativeListener()
  return () => {
    actionHandlers.delete(handler)
  }
}

export async function startNativeMediaPlayback(opts?: NativeMediaSessionUpdate): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await ensureNativeListener()
  try {
    await MediaPlayback.start({
      title: opts?.title || 'SafeTube',
      artist: opts?.artist || 'מתנגן עכשיו',
      durationMs: opts?.durationMs,
      positionMs: opts?.positionMs,
      playing: opts?.playing ?? true,
      artworkUrl: opts?.artworkUrl ?? undefined,
      canSkipNext: opts?.canSkipNext ?? true,
      canSkipPrev: opts?.canSkipPrev ?? true,
    })
  } catch (err) {
    console.warn('[mediaPlayback] start failed', err)
  }
}

export async function updateNativeMediaSession(opts: NativeMediaSessionUpdate): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await MediaPlayback.updateSession(opts)
  } catch (err) {
    console.warn('[mediaPlayback] updateSession failed', err)
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

/** System music-stream volume (affects YouTube iframe audio on Android). */
export async function adjustNativeMusicVolume(
  direction: 'raise' | 'lower' | 'mute' | 'toggleMute'
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await MediaPlayback.adjustVolume({ direction })
  } catch (err) {
    console.warn('[mediaPlayback] adjustVolume failed', err)
  }
}

/** Activity orientation lock for fullscreen theater (does not touch playback). */
export async function setNativeOrientationLock(
  mode: NativeOrientationLockMode
): Promise<NativeOrientationLockResult | void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    return await MediaPlayback.setOrientationLock({ mode })
  } catch (err) {
    console.warn('[mediaPlayback] setOrientationLock failed', err)
    throw err
  }
}
