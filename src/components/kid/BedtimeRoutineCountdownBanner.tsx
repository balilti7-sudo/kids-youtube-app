import { Moon } from 'lucide-react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { isBedtimeRoutineInProgress } from '../../lib/bedtimeRoutineProgress'
import { normalizeGracePeriodMinutes } from '../../lib/bedtimeRoutinePhase'
import { useBedtimeGraceCountdown } from '../../hooks/useBedtimeRoutineCountdown'
import { BedtimeRoutineEmergencyExit } from './BedtimeRoutineEmergencyExit'
import { cn } from '../../lib/utils'

function formatMmSs(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type Props = {
  className?: string
}

/** Parent-started grace countdown — child can still watch until it reaches zero. */
export function BedtimeRoutineCountdownBanner({ className }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const seconds = useBedtimeGraceCountdown(bedtime)
  const graceMinutes = normalizeGracePeriodMinutes(bedtime?.gracePeriodMinutes)

  const showParentApprove = Boolean(
    bedtime?.tasksCompleted && !bedtime.parentApproved && !bedtime.wheelSpun
  )
  const inProgress = isBedtimeRoutineInProgress(bedtime)

  if (seconds <= 0) return null

  return (
    <div
      className={cn(
        'rounded-2xl border border-indigo-400/30 bg-gradient-to-r from-indigo-950/90 via-violet-950/85 to-indigo-950/90 px-4 py-3 text-center shadow-lg shadow-indigo-950/40',
        className
      )}
      role="status"
      aria-live="polite"
      dir="rtl"
    >
      <div className="flex flex-col items-center gap-2">
        <Moon className="h-5 w-5 shrink-0 text-amber-200" aria-hidden />
        <p className="text-sm font-bold text-indigo-50">
          שגרת השינה מתחילה בעוד{' '}
          <span className="tabular-nums text-amber-200">{formatMmSs(seconds)}</span>
          <span className="mt-1 block text-xs font-medium text-indigo-200/80">
            (ההורה התחיל {graceMinutes} דקות חסד — אפשר עדיין לצפות)
            {inProgress ? ' · ממתינים לאישור הורים לפני הגלגל' : null}
          </span>
        </p>
        <BedtimeRoutineEmergencyExit variant="inline" showParentApprove={showParentApprove} />
      </div>
    </div>
  )
}
