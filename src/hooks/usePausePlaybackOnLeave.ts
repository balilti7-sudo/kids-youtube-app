import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { pauseAllPlayback } from '../lib/playbackController'
import { isMediaPlaybackActive } from '../lib/mediaPlaybackActivity'

/**
 * Pause all registered players when the app loses focus —
 * unless media is actively playing (background / screen-off audio).
 */
export function usePausePlaybackOnLeave(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    const shouldKeepPlaying = () => isMediaPlaybackActive()

    const onHidden = () => {
      if (document.visibilityState === 'hidden' && shouldKeepPlaying()) return
      if (document.visibilityState === 'hidden') pauseAllPlayback()
    }

    const onCordovaPause = () => {
      if (shouldKeepPlaying()) return
      pauseAllPlayback()
    }

    document.addEventListener('visibilitychange', onHidden)
    document.addEventListener('pause', onCordovaPause)

    let removeAppListener: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive && shouldKeepPlaying()) return
        if (!isActive) pauseAllPlayback()
      }).then((handle) => {
        removeAppListener = () => void handle.remove()
      })
    }

    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      document.removeEventListener('pause', onCordovaPause)
      removeAppListener?.()
    }
  }, [enabled])
}
