import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_THRESHOLD_PX = 72
const AXIS_RATIO = 1.25
const MAX_DRAG_VISUAL_PX = 96

export type HorizontalSwipeHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

/**
 * Horizontal swipe on playlist rows:
 * - swipe left (finger moves left) → onSwipeLeft (remove from playlist)
 * - swipe right → onSwipeRight (block permanently)
 */
export function useHorizontalSwipeRow(options: {
  enabled?: boolean
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  thresholdPx?: number
}): {
  rowRef: React.RefObject<HTMLDivElement | null>
  handlers: HorizontalSwipeHandlers
  dragOffsetX: number
  swiping: boolean
  reset: () => void
} {
  const {
    enabled = true,
    onSwipeLeft,
    onSwipeRight,
    thresholdPx = DEFAULT_THRESHOLD_PX,
  } = options

  const rowRef = useRef<HTMLDivElement | null>(null)
  const onSwipeLeftRef = useRef(onSwipeLeft)
  const onSwipeRightRef = useRef(onSwipeRight)
  onSwipeLeftRef.current = onSwipeLeft
  onSwipeRightRef.current = onSwipeRight

  const trackingRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    axisLocked: 'none' | 'vertical' | 'horizontal'
  } | null>(null)

  const [dragOffsetX, setDragOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)

  const reset = useCallback(() => {
    trackingRef.current = null
    setDragOffsetX(0)
    setSwiping(false)
  }, [])

  const finishGesture = useCallback(
    (clientX: number, clientY: number) => {
      const track = trackingRef.current
      if (!track) {
        reset()
        return
      }
      const dx = clientX - track.startX
      const dy = clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const horizontal =
        track.axisLocked === 'horizontal' ||
        (absDx >= thresholdPx && absDx >= absDy * AXIS_RATIO)

      if (horizontal && absDx >= thresholdPx) {
        if (dx < 0) onSwipeLeftRef.current?.()
        else onSwipeRightRef.current?.()
      }
      reset()
    },
    [reset, thresholdPx]
  )

  useEffect(() => {
    const el = rowRef.current
    if (!el || !enabled) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]!
      trackingRef.current = {
        pointerId: -1,
        startX: touch.clientX,
        startY: touch.clientY,
        axisLocked: 'none',
      }
      setSwiping(true)
    }

    const onTouchMove = (e: TouchEvent) => {
      const track = trackingRef.current
      if (!track || e.touches.length !== 1) return
      const touch = e.touches[0]!
      const dx = touch.clientX - track.startX
      const dy = touch.clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (track.axisLocked === 'none' && (absDx > 8 || absDy > 8)) {
        if (absDx >= absDy * AXIS_RATIO) track.axisLocked = 'horizontal'
        else if (absDy >= absDx * AXIS_RATIO) {
          trackingRef.current = null
          setDragOffsetX(0)
          setSwiping(false)
          return
        }
      }

      if (track.axisLocked === 'horizontal') {
        e.preventDefault()
        const clamped = Math.max(-MAX_DRAG_VISUAL_PX, Math.min(MAX_DRAG_VISUAL_PX, dx))
        setDragOffsetX(clamped)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      if (!touch) {
        reset()
        return
      }
      finishGesture(touch.clientX, touch.clientY)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [enabled, finishGesture, reset])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return
      trackingRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        axisLocked: 'none',
      }
      setSwiping(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [enabled]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const track = trackingRef.current
    if (!track || track.pointerId !== e.pointerId) return
    const dx = e.clientX - track.startX
    const dy = e.clientY - track.startY
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    if (track.axisLocked === 'none' && (absDx > 8 || absDy > 8)) {
      if (absDx >= absDy * AXIS_RATIO) track.axisLocked = 'horizontal'
      else if (absDy >= absDx * AXIS_RATIO) {
        reset()
        return
      }
    }

    if (track.axisLocked === 'horizontal') {
      const clamped = Math.max(-MAX_DRAG_VISUAL_PX, Math.min(MAX_DRAG_VISUAL_PX, dx))
      setDragOffsetX(clamped)
    }
  }, [reset])

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const track = trackingRef.current
      if (!track || track.pointerId !== e.pointerId) return
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      finishGesture(e.clientX, e.clientY)
    },
    [finishGesture]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      const track = trackingRef.current
      if (!track || track.pointerId !== e.pointerId) return
      reset()
    },
    [reset]
  )

  return {
    rowRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    dragOffsetX,
    swiping,
    reset,
  }
}
