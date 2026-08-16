import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_THRESHOLD_PX = 72
const AXIS_RATIO = 1.25
/** Leave room for native / custom video controls at the bottom. */
const DEFAULT_BOTTOM_DEADZONE_PX = 72
const MAX_DRAG_VISUAL_PX = 120

export type VerticalSwipeNavHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

/**
 * YouTube Shorts–style vertical swipe: up → next, down → previous.
 * Uses non-passive touch listeners so page scroll can be blocked once a vertical gesture wins.
 */
export function useVerticalSwipeNav(options: {
  enabled?: boolean
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  thresholdPx?: number
  bottomDeadzonePx?: number
}): {
  containerRef: React.RefObject<HTMLDivElement | null>
  handlers: VerticalSwipeNavHandlers
  dragOffsetY: number
  swiping: boolean
} {
  const {
    enabled = true,
    onSwipeUp,
    onSwipeDown,
    thresholdPx = DEFAULT_THRESHOLD_PX,
    bottomDeadzonePx = DEFAULT_BOTTOM_DEADZONE_PX,
  } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const onSwipeUpRef = useRef(onSwipeUp)
  const onSwipeDownRef = useRef(onSwipeDown)
  onSwipeUpRef.current = onSwipeUp
  onSwipeDownRef.current = onSwipeDown

  const trackingRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    axisLocked: 'none' | 'vertical' | 'horizontal'
    fromBottomControls: boolean
  } | null>(null)

  const [dragOffsetY, setDragOffsetY] = useState(0)
  const [swiping, setSwiping] = useState(false)

  const reset = useCallback(() => {
    trackingRef.current = null
    setDragOffsetY(0)
    setSwiping(false)
  }, [])

  const finishGesture = useCallback(
    (clientX: number, clientY: number) => {
      const track = trackingRef.current
      if (!track || track.fromBottomControls) {
        reset()
        return
      }
      const dx = clientX - track.startX
      const dy = clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const vertical =
        track.axisLocked === 'vertical' ||
        (absDy >= thresholdPx && absDy >= absDx * AXIS_RATIO)

      if (vertical && absDy >= thresholdPx) {
        if (dy < 0) onSwipeUpRef.current?.()
        else onSwipeDownRef.current?.()
      }
      reset()
    },
    [reset, thresholdPx]
  )

  // Touch path (mobile): non-passive so we can prevent page scroll during vertical Shorts swipe.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]!
      const rect = el.getBoundingClientRect()
      const fromBottom = touch.clientY > rect.bottom - bottomDeadzonePx
      trackingRef.current = {
        pointerId: -1,
        startX: touch.clientX,
        startY: touch.clientY,
        axisLocked: 'none',
        fromBottomControls: fromBottom,
      }
      setSwiping(false)
      setDragOffsetY(0)
    }

    const onTouchMove = (e: TouchEvent) => {
      const track = trackingRef.current
      if (!track || track.fromBottomControls || e.touches.length !== 1) return
      const touch = e.touches[0]!
      const dx = touch.clientX - track.startX
      const dy = touch.clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (track.axisLocked === 'none' && (absDx > 10 || absDy > 10)) {
        track.axisLocked = absDy >= absDx * AXIS_RATIO ? 'vertical' : 'horizontal'
      }

      if (track.axisLocked === 'vertical') {
        e.preventDefault()
        setSwiping(true)
        const clamped = Math.max(-MAX_DRAG_VISUAL_PX, Math.min(MAX_DRAG_VISUAL_PX, dy * 0.35))
        setDragOffsetY(clamped)
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

    const onTouchCancel = () => reset()

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchCancel)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [enabled, bottomDeadzonePx, finishGesture, reset])

  // Pointer path (mouse / pen) for desktop testing.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.pointerType === 'touch') return
      if (e.button !== 0) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const fromBottom = e.clientY > rect.bottom - bottomDeadzonePx
      trackingRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        axisLocked: 'none',
        fromBottomControls: fromBottom,
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    [enabled, bottomDeadzonePx]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const track = trackingRef.current
      if (!track || track.pointerId !== e.pointerId || track.fromBottomControls) return
      if (e.pointerType === 'touch') return
      const dx = e.clientX - track.startX
      const dy = e.clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (track.axisLocked === 'none' && (absDx > 10 || absDy > 10)) {
        track.axisLocked = absDy >= absDx * AXIS_RATIO ? 'vertical' : 'horizontal'
      }
      if (track.axisLocked === 'vertical') {
        setSwiping(true)
        const clamped = Math.max(-MAX_DRAG_VISUAL_PX, Math.min(MAX_DRAG_VISUAL_PX, dy * 0.35))
        setDragOffsetY(clamped)
      }
    },
    []
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return
      const track = trackingRef.current
      if (!track || track.pointerId !== e.pointerId) return
      finishGesture(e.clientX, e.clientY)
    },
    [finishGesture]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'touch') return
      reset()
    },
    [reset]
  )

  useEffect(() => {
    if (!enabled) reset()
  }, [enabled, reset])

  return {
    containerRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    dragOffsetY,
    swiping,
  }
}
