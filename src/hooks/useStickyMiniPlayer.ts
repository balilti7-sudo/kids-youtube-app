import { useEffect, useRef, useState } from 'react'
import { requestPlayerChromeBump } from './useAutoHidePlayerChrome'
import { requestChromeOffsetRefresh, subscribeViewportGeometryRefresh } from '../lib/chromeOffset'
import { isPlayerExpanded, isPlayerTheaterActive } from '../lib/playerTheater'

/**
 * When the primary player slot scrolls out of view, pin the same mounted player
 * node to the bottom corner (no remount / no second stream).
 * Layout guard: never assert mini while document fullscreen / CSS theater is active.
 */
export function useStickyMiniPlayer(options?: { enabled?: boolean; resetKey?: string }) {
  const enabled = options?.enabled ?? true
  const resetKey = options?.resetKey ?? ''
  const slotRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [isMini, setIsMini] = useState(false)
  const [slotHeight, setSlotHeight] = useState<number | null>(null)
  const [theaterActive, setTheaterActive] = useState(false)
  const wasMiniRef = useRef(false)

  // Only drop mini when the feature turns off (e.g. Shorts). Do NOT reset on
  // videoId — toggling fixed/transform around a YouTube iframe blacks the
  // Android SurfaceView (green robot placeholder) until a full remount.
  useEffect(() => {
    if (enabled) return
    setIsMini(false)
    setSlotHeight(null)
    wasMiniRef.current = false
  }, [enabled])

  useEffect(() => {
    const syncTheater = () => {
      const on = isPlayerExpanded() || isPlayerTheaterActive()
      setTheaterActive(on)
      if (on) {
        setIsMini(false)
        setSlotHeight(null)
      }
    }
    syncTheater()
    document.addEventListener('fullscreenchange', syncTheater)
    document.addEventListener('webkitfullscreenchange', syncTheater)
    const mo = new MutationObserver(syncTheater)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      document.removeEventListener('fullscreenchange', syncTheater)
      document.removeEventListener('webkitfullscreenchange', syncTheater)
      mo.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!enabled || theaterActive) return
    const sentinel = sentinelRef.current
    const slot = slotRef.current
    if (!sentinel || !slot || typeof IntersectionObserver === 'undefined') return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (isPlayerExpanded()) {
          setIsMini(false)
          setSlotHeight(null)
          return
        }
        if (!entry.isIntersecting) {
          const h = slot.getBoundingClientRect().height
          if (h > 0) setSlotHeight(h)
          setIsMini(true)
        } else {
          setIsMini(false)
          setSlotHeight(null)
        }
      },
      { threshold: 0 }
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [enabled, resetKey, theaterActive])

  const effectiveMini = isMini && !theaterActive

  useEffect(() => {
    if (wasMiniRef.current === effectiveMini) return
    wasMiniRef.current = effectiveMini
    requestPlayerChromeBump()
    requestChromeOffsetRefresh()
  }, [effectiveMini])

  // After rotate / visualViewport change while mini, keep reserved slot height + chrome in sync.
  useEffect(() => {
    if (!effectiveMini) return
    const refresh = () => {
      const slot = slotRef.current
      if (!slot) return
      const h = slot.getBoundingClientRect().height
      if (h > 0) setSlotHeight(h)
      requestPlayerChromeBump()
    }
    return subscribeViewportGeometryRefresh(refresh)
  }, [effectiveMini])

  return {
    slotRef,
    sentinelRef,
    isMini: effectiveMini,
    slotStyle: effectiveMini && slotHeight != null ? ({ height: slotHeight } as const) : undefined,
  }
}
