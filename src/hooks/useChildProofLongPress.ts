import { useCallback, useRef, useState } from 'react'

export const CHILD_PROOF_HOLD_MS = 3000
const HINT_VISIBLE_MS = 2600

export type ChildProofLongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerLeave: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function useChildProofLongPress(options: {
  onComplete: () => void
  enabled?: boolean
  durationMs?: number
}): {
  holding: boolean
  progress: number
  shaking: boolean
  showHint: boolean
  handlers: ChildProofLongPressHandlers
} {
  const { onComplete, enabled = true, durationMs = CHILD_PROOF_HOLD_MS } = options
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [shaking, setShaking] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const startAtRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const wasHoldingRef = useRef(false)
  const hintTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)

  const clearRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
  }, [])

  const clearShakeTimer = useCallback(() => {
    if (shakeTimerRef.current != null) {
      window.clearTimeout(shakeTimerRef.current)
      shakeTimerRef.current = null
    }
  }, [])

  const flashShortPressHint = useCallback(() => {
    clearHintTimer()
    clearShakeTimer()
    setShaking(true)
    setShowHint(true)
    shakeTimerRef.current = window.setTimeout(() => setShaking(false), 520)
    hintTimerRef.current = window.setTimeout(() => setShowHint(false), HINT_VISIBLE_MS)
  }, [clearHintTimer, clearShakeTimer])

  const endHold = useCallback(
    (triggerShortPressHint: boolean) => {
      const wasHolding = wasHoldingRef.current
      const completed = completedRef.current
      clearRaf()
      wasHoldingRef.current = false
      setHolding(false)
      setProgress(0)
      if (triggerShortPressHint && wasHolding && !completed) {
        flashShortPressHint()
      }
    },
    [clearRaf, flashShortPressHint]
  )

  const tick = useCallback(() => {
    const elapsed = Date.now() - startAtRef.current
    const nextProgress = Math.min(1, elapsed / durationMs)
    setProgress(nextProgress)
    if (nextProgress >= 1) {
      completedRef.current = true
      endHold(false)
      onComplete()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [durationMs, endHold, onComplete])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      if (e.button !== 0) return
      e.preventDefault()
      completedRef.current = false
      wasHoldingRef.current = true
      startAtRef.current = Date.now()
      setHolding(true)
      setProgress(0)
      clearRaf()
      rafRef.current = requestAnimationFrame(tick)
    },
    [clearRaf, enabled, tick]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return
      e.preventDefault()
      endHold(true)
    },
    [enabled, endHold]
  )

  const onPointerLeave = useCallback(() => {
    if (!enabled) return
    endHold(true)
  }, [enabled, endHold])

  const onPointerCancel = useCallback(() => {
    if (!enabled) return
    endHold(true)
  }, [enabled, endHold])

  const onClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return {
    holding,
    progress,
    shaking,
    showHint,
    handlers: {
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onClick,
      onContextMenu,
    },
  }
}
