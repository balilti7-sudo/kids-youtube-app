import { useEffect, useRef, useState } from 'react'
import { requestPlayerChromeBump } from './useAutoHidePlayerChrome'
import { requestChromeOffsetRefresh, subscribeViewportGeometryRefresh } from '../lib/chromeOffset'
import { isPlayerExpanded } from '../lib/playerTheater'
import { getPlaybackPlayerMode } from '../lib/playbackPlayerMode'
import { modeBlocksStickyMini, usePlayerModeOptional } from '../contexts/PlayerModeContext'

/**
 * When the primary player slot scrolls out of view, pin the same mounted player
 * node to the bottom corner (no remount / no second stream).
 * Layout guard: never assert mini while theater / shorts lane is active.
 */
export function useStickyMiniPlayer(options?: { enabled?: boolean; resetKey?: string }) {
  const enabled = options?.enabled ?? true
  const resetKey = options?.resetKey ?? ''
  const slotRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [isMini, setIsMini] = useState(false)
  const [slotHeight, setSlotHeight] = useState<number | null>(null)
  const wasMiniRef = useRef(false)
  const playerMode = usePlayerModeOptional()
  const layoutMode = playerMode?.mode ?? getPlaybackPlayerMode()
  // isPlayerExpanded: sync guard — React playerMode updates after theater DOM (Phase 1 regression fix).
  const theaterActive = modeBlocksStickyMini(layoutMode) || isPlayerExpanded()

  // Only drop mini when the feature turns off (e.g. Shorts). Do NOT reset on
  // videoId — toggling fixed/transform around a YouTube iframe blacks the
  // Android SurfaceView (green robot placeholder) until a full remount.
  useEffect(() => {
    if (enabled) return
    setIsMini(false)
    setSlotHeight(null)
    wasMiniRef.current = false
    playerMode?.notifyMiniActive(false)
  }, [enabled, playerMode])

  useEffect(() => {
    if (theaterActive) {
      setIsMini(false)
      setSlotHeight(null)
      playerMode?.notifyMiniActive(false)
    }
  }, [theaterActive, playerMode])

  useEffect(() => {
    if (!enabled || theaterActive) return
    const sentinel = sentinelRef.current
    const slot = slotRef.current
    if (!sentinel || !slot || typeof IntersectionObserver === 'undefined') return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (isPlayerExpanded() || modeBlocksStickyMini(playerMode?.mode ?? getPlaybackPlayerMode())) {
          setIsMini(false)
          setSlotHeight(null)
          playerMode?.notifyMiniActive(false)
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
  }, [enabled, resetKey, theaterActive, playerMode])

  const effectiveMini = isMini && !theaterActive

  useEffect(() => {
    playerMode?.notifyMiniActive(effectiveMini)
  }, [effectiveMini, playerMode])

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
