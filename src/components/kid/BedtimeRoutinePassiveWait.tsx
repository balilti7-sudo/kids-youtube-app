import { motion } from 'framer-motion'
import { Moon, Sparkles } from 'lucide-react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { normalizeGracePeriodMinutes } from '../../lib/bedtimeRoutinePhase'
import { BedtimeRoutineEmergencyExit } from './BedtimeRoutineEmergencyExit'
import { BedtimeRoutineParentStartButton } from './BedtimeRoutineParentStartButton'
import { cn } from '../../lib/utils'

type Props = {
  className?: string
}

/**
 * Passive bedtime notice — no timer, no lock. Child can keep watching until parent starts grace.
 */
export function BedtimeRoutinePassiveWait({ className }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const graceMinutes = normalizeGracePeriodMinutes(bedtime?.gracePeriodMinutes)

  return (
    <div
      className={cn(
        'sticky top-0 z-[55] border-b border-indigo-400/25 bg-gradient-to-r from-indigo-950/95 via-violet-950/90 to-indigo-950/95 px-4 py-4 shadow-lg shadow-indigo-950/30',
        className
      )}
      dir="rtl"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="flex items-center gap-2 text-amber-200"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          <Moon className="h-6 w-6" aria-hidden />
          <Sparkles className="h-4 w-4" aria-hidden />
        </motion.div>

        <div>
          <h2 className="text-base font-black text-white sm:text-lg">הגיע זמן לישון 🌙</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-indigo-100/90">
            אפשר להמשיך לצפות עד שההורה יתחיל את שגרת השינה. אחרי אישור עם קוד PIN יפתחו{' '}
            <span className="font-bold text-amber-200">{graceMinutes} דקות</span> לסיום, ואז תתחיל
            השגרה.
          </p>
        </div>

        <BedtimeRoutineParentStartButton className="w-full max-w-xs justify-center" compact />

        <BedtimeRoutineEmergencyExit variant="inline" />
      </div>
    </div>
  )
}
