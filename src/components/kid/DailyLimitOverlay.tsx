import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { Button } from '../ui/Button'
import { LionMascot } from './LionMascot'
import { useParentManagementPinVerify } from '../../hooks/useParentManagementPinVerify'
import { resetDailyWatchToday } from '../../lib/dailyWatchBudget'
import {
  DAILY_WATCH_SNOOZE_MINUTES,
  useDailyWatchBudgetStore,
} from '../../stores/dailyWatchBudgetStore'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { cn } from '../../lib/utils'

type Props = {
  className?: string
  onSnoozed?: () => void
}

export function DailyLimitOverlay({ className, onSnoozed }: Props) {
  const snoozeMinutes = useDailyWatchBudgetStore((s) => s.snoozeMinutes)
  const clearWatchToday = useDailyWatchBudgetStore((s) => s.clearWatchToday)
  const deviceId = useDailyWatchBudgetStore((s) => s.deviceId)
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'
  const verifyParentPin = useParentManagementPinVerify()

  /** Show parent PIN immediately — no extra tap when limit is already reached. */
  const [pinOpen, setPinOpen] = useState(true)
  const [parentVerified, setParentVerified] = useState(false)
  const [unlocking, setUnlocking] = useState(false)

  const handleUnlockContinue = async () => {
    if (!deviceId) {
      snoozeMinutes(DAILY_WATCH_SNOOZE_MINUTES)
      setParentVerified(false)
      setPinOpen(false)
      onSnoozed?.()
      return
    }
    setUnlocking(true)
    const { data, error } = await resetDailyWatchToday(deviceId)
    setUnlocking(false)
    if (error || !data) {
      // Fallback: local snooze if server reset is unavailable (migration not applied yet).
      console.warn('[DailyLimitOverlay] reset today failed', error?.message)
      snoozeMinutes(DAILY_WATCH_SNOOZE_MINUTES)
      toast.message('הוארכו כמה דקות צפייה. אם החסימה חוזרת, הריצו את עדכון מסד הנתונים.')
    } else {
      clearWatchToday(data)
      toast.success('הצפייה שוחררה להיום')
    }
    setParentVerified(false)
    setPinOpen(false)
    onSnoozed?.()
  }

  const handleVerified = useCallback(() => {
    setPinOpen(false)
    setParentVerified(true)
  }, [])

  return (
    <>
      <div
        className={cn(
          'absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-indigo-950/95 via-violet-950/95 to-zinc-950/95 px-6 text-center',
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-limit-title"
        dir="rtl"
      >
        <div className="flex items-center gap-2 text-violet-200/90">
          <Clock className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-widest text-violet-100/80">
            מגבלת צפייה יומית
          </span>
        </div>

        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          className="max-w-[200px]"
        >
          <LionMascot mood="worried" outfitId={outfitId} />
        </motion.div>

        <div className="space-y-4">
          <h2 id="daily-limit-title" className="max-w-sm text-lg font-bold leading-relaxed text-zinc-50">
            הזמן היומי לצפייה נגמר. בקשו מההורה להזין את קוד ה-PIN כדי להמשיך.
          </h2>

          {parentVerified ? (
            <Button
              type="button"
              className="min-w-[180px]"
              disabled={unlocking}
              onClick={() => void handleUnlockContinue()}
            >
              {unlocking ? 'משחרר…' : 'המשך צפייה'}
            </Button>
          ) : (
            <p className="max-w-xs text-sm text-violet-200/90">
              נפתח חלון להזנת קוד הורה — אחרי אימות אפשר להמשיך לצפות.
            </p>
          )}

          {!parentVerified && !pinOpen ? (
            <Button type="button" className="min-w-[180px]" onClick={() => setPinOpen(true)}>
              הזנת קוד הורה
            </Button>
          ) : null}
        </div>
      </div>

      <ParentalPinModal
        open={pinOpen && !parentVerified}
        onClose={() => setPinOpen(false)}
        onVerified={handleVerified}
        verifyPin={verifyParentPin}
        title="אימות הורה"
        description="הזינו את קוד ה-PIN של ההורה כדי לשחרר את הצפייה."
      />
    </>
  )
}
