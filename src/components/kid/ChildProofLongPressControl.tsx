import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { CHILD_PROOF_HOLD_MS, useChildProofLongPress } from '../../hooks/useChildProofLongPress'

const HOLD_HINT = 'לחץ והחזק 3 שניות'

type Props = {
  onComplete: () => void
  enabled?: boolean
  durationMs?: number
  children: ReactNode
  className?: string
  /** 'ring' wraps control with circular progress; 'bar' fills bottom edge */
  progressStyle?: 'ring' | 'bar'
  ariaLabel?: string
  title?: string
}

export function ChildProofLongPressControl({
  onComplete,
  enabled = true,
  durationMs = CHILD_PROOF_HOLD_MS,
  children,
  className,
  progressStyle = 'ring',
  ariaLabel,
  title,
}: Props) {
  const { holding, progress, shaking, showHint, handlers } = useChildProofLongPress({
    onComplete,
    enabled,
    durationMs,
  })

  const ringDegrees = Math.round(progress * 360)
  const secondsLabel = Math.round(durationMs / 100) / 10

  return (
    <span className={cn('relative inline-flex max-w-full min-w-0', className)}>
      <button
        type="button"
        aria-label={ariaLabel ?? `לחיצה ארוכה ${secondsLabel} שניות`}
        title={title ?? `החזיקו לחוץ ${secondsLabel} שנ׳`}
        className={cn(
          'relative inline-flex touch-manipulation select-none',
          shaking && 'animate-child-proof-shake',
          holding && 'scale-[0.98]'
        )}
        {...handlers}
      >
        {progressStyle === 'ring' && holding ? (
          <span
            className="pointer-events-none absolute -inset-1 rounded-full"
            style={{
              background: `conic-gradient(rgb(56 189 248) ${ringDegrees}deg, rgb(63 63 70 / 0.45) ${ringDegrees}deg)`,
            }}
            aria-hidden
          />
        ) : null}
        {progressStyle === 'bar' && holding ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-full bg-zinc-700/80" aria-hidden>
            <span
              className="block h-full origin-left rounded-full bg-sky-400 transition-[width] duration-75"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        ) : null}
        <span className={cn('relative z-[1] inline-flex', progressStyle === 'ring' && holding && 'p-0.5')}>
          {children}
        </span>
      </button>
      {showHint ? (
        <span
          role="status"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 animate-child-proof-hint whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-bold text-sky-100 shadow-lg ring-1 ring-sky-500/40"
        >
          {HOLD_HINT}
        </span>
      ) : null}
    </span>
  )
}

export { HOLD_HINT }
