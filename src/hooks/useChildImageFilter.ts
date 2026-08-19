import { useEffect } from 'react'
import { syncChildDisplayPrefs } from '../lib/childDisplayNative'

const ROOT_CLASS = 'safetube-hide-images'

/** Applies kid image-filter mode to the app shell (not the YouTube embed iframe). */
export function useChildImageFilter(enabled: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle(ROOT_CLASS, enabled)
    void syncChildDisplayPrefs({ hideThumbnails: enabled })
    return () => {
      document.documentElement.classList.remove(ROOT_CLASS)
    }
  }, [enabled])
}
