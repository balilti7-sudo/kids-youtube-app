import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

type LongPressHandlers = {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  /** Call at the start of onClick — returns true if a long-press already fired (skip click). */
  consumeLongPress: () => boolean
}

/**
 * Touch/mouse long-press without blocking normal taps.
 * Default ~550ms matches common mobile “hold to delete” UX.
 */
export function useLongPress(onLongPress: () => void, durationMs = 550): LongPressHandlers {
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      firedRef.current = false
      clear()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        firedRef.current = true
        onLongPress()
      }, durationMs)
    },
    [clear, durationMs, onLongPress]
  )

  const consumeLongPress = useCallback(() => {
    const fired = firedRef.current
    firedRef.current = false
    return fired
  }, [])

  return {
    onPointerDown,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    consumeLongPress,
  }
}
