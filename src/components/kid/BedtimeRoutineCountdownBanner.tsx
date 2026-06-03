import { Moon } from 'lucide-react'
import { useBedtimeRoutineStore } from '../../stores/bedtimeRoutineStore'
import { cn } from '../../lib/utils'

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type Props = {
  className?: string
}

/** Shown while the 5-minute pre-routine countdown is running (watching still allowed). */
export function BedtimeRoutineCountdownBanner({ className }: Props) {
  const seconds = useBedtimeRoutineStore((s) => s.countdownRemainingSeconds)
  const isRoutineActive = useBedtimeRoutineStore((s) => s.isRoutineActive)

  if (isRoutineActive || seconds <= 0) return null

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 rounded-2xl border border-indigo-400/30 bg-gradient-to-r from-indigo-950/90 via-violet-950/85 to-indigo-950/90 px-4 py-3 text-center shadow-lg shadow-indigo-950/40',
        className
      )}
      role="status"
      aria-live="polite"
      dir="rtl"
    >
      <Moon className="h-5 w-5 shrink-0 text-amber-200" aria-hidden />
      <p className="text-sm font-bold text-indigo-50">
        שגרת השינה מתחילה בעוד{' '}
        <span className="tabular-nums text-amber-200">{formatMmSs(seconds)}</span>
      </p>
    </div>
  )
}
