import { useEffect, useRef, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { cn } from '../../lib/utils'

type Props = {
  /** Minutes remaining until the educational break (drives the countdown). */
  minutesUntilBreak: number
  onTimerEnd: () => void
  className?: string
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m > 0 && r > 0) return `${m}:${String(r).padStart(2, '0')}`
  if (m > 0) return `${m}:00`
  return `0:${String(r).padStart(2, '0')}`
}

/**
 * Small top-right countdown before an educational break.
 * Uses a wall-clock anchor (Date.now) so ticks do not depend on parent re-renders.
 */
export function CountdownOverlay({ minutesUntilBreak, onTimerEnd, className }: Props) {
  const onTimerEndRef = useRef(onTimerEnd)
  onTimerEndRef.current = onTimerEnd

  const durationMs = Math.max(0, minutesUntilBreak) * 60 * 1000
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.ceil(Math.max(0, minutesUntilBreak) * 60)
  )

  useEffect(() => {
    if (durationMs <= 0) {
      setSecondsLeft(0)
      onTimerEndRef.current()
      return
    }

    const endsAt = Date.now() + durationMs
    let finished = false

    const tick = () => {
      const remainingMs = endsAt - Date.now()
      if (remainingMs <= 0) {
        if (!finished) {
          finished = true
          setSecondsLeft(0)
          onTimerEndRef.current()
        }
        return
      }
      setSecondsLeft(Math.ceil(remainingMs / 1000))
    }

    tick()
    const intervalId = window.setInterval(tick, 1000)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [durationMs])

  const ariaLabel =
    secondsLeft >= 60
      ? `עוד ${Math.ceil(secondsLeft / 60)} דקות להפסקה`
      : secondsLeft <= 1
        ? 'הפסקה בעוד רגע'
        : `עוד ${secondsLeft} שניות להפסקה`

  return (
    <div
      className={cn(
        'pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-lg',
        'border border-violet-400/40 bg-violet-950/90 px-2 py-1 text-violet-50',
        'shadow-md shadow-black/35 backdrop-blur-sm ring-1 ring-violet-300/15',
        className
      )}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
    >
      <GraduationCap className="h-3.5 w-3.5 shrink-0 text-violet-200" aria-hidden />
      <span className="font-mono text-xs font-semibold tabular-nums">{formatCountdown(secondsLeft)}</span>
    </div>
  )
}
