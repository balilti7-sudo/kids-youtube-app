import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { pauseAllPlayback } from '../lib/playbackController'

/**
 * Pause all registered players when the app loses focus:
 * background, screen lock, switch to another app, or WebView hidden.
 */
export function usePausePlaybackOnLeave(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return

    const onHidden = () => {
      if (document.visibilityState === 'hidden') pauseAllPlayback()
    }

    const onCordovaPause = () => pauseAllPlayback()

    document.addEventListener('visibilitychange', onHidden)
    document.addEventListener('pause', onCordovaPause)

    let removeAppListener: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void App.addListener('appStateChange', ({ isActive }) => {
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
