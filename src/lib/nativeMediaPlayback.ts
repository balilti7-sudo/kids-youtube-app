/**
 * Capacitor bridge for Android MediaSession + foreground media service.
 * Exposes transport events from Bluetooth / lock screen / notification into the WebView player.
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

export interface MediaPlaybackPlugin {
  start(options?: NativeMediaSessionUpdate): Promise<void>
  updateSession(options: NativeMediaSessionUpdate): Promise<void>
  stop(): Promise<void>
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
