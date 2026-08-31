import { useEffect } from 'react'
import { syncChildDisplayPrefs } from '../lib/childDisplayNative'

const ROOT_CLASS = 'safetube-hide-images'

/** Applies kid image-filter mode to the app shell (not the YouTube embed iframe). */
export function useChildImageFilter(enabled: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    // Feature retired: never hide images / black-frame the player.
    const active = false
    document.documentElement.classList.toggle(ROOT_CLASS, active)
    void syncChildDisplayPrefs({ hideThumbnails: false })
    return () => {
      document.documentElement.classList.remove(ROOT_CLASS)
    }
  }, [enabled])
}
