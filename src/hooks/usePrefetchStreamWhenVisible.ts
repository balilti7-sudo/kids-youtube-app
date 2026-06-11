import { useCallback, useEffect, useRef } from 'react'
import { prefetchStreamInfo } from '../lib/streamApi'

/**
 * When `videoId` is set and the returned element enters (or nears) the viewport,
 * warm `GET /api/stream/:videoId` in the background.
 */
export function usePrefetchStreamWhenVisible(
  videoId: string | null | undefined,
  enabled = true
): (node: HTMLElement | null) => void {
  const kickedRef = useRef(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    kickedRef.current = false
  }, [videoId])

  useEffect(() => {
    return () => observerRef.current?.disconnect()
  }, [])

  return useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null

      const id = videoId?.trim()
      if (!el || !enabled || !id) return

      if (typeof IntersectionObserver === 'undefined') {
        if (!kickedRef.current) {
          kickedRef.current = true
          prefetchStreamInfo(id)
        }
        return
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting || kickedRef.current) continue
            kickedRef.current = true
            prefetchStreamInfo(id)
            observer.disconnect()
            observerRef.current = null
          }
        },
        { root: null, rootMargin: '240px 0px', threshold: 0.01 }
      )
      observer.observe(el)
      observerRef.current = observer
    },
    [videoId, enabled]
  )
}
