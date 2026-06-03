import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, ShieldCheck } from 'lucide-react'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { Button } from '../ui/Button'
import { LionMascot } from './LionMascot'
import { useAuth } from '../../hooks/useAuth'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { readLocalParentSession } from '../../lib/localParentAdmin'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
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
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const snoozeMinutes = useDailyWatchBudgetStore((s) => s.snoozeMinutes)
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'

  const [pinOpen, setPinOpen] = useState(false)
  const [parentVerified, setParentVerified] = useState(false)

  const localPin = readLocalParentSession()?.pin?.trim() ?? ''

  const verifyParentPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin ?? localPin },
        },
        pin
      ),
    [user?.id, profile, localParent.isActive, localParent.pin, localPin]
  )

  const handleSnooze = () => {
    snoozeMinutes(DAILY_WATCH_SNOOZE_MINUTES)
    setParentVerified(false)
    onSnoozed?.()
  }

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
        dir="ltr"
      >
        <div className="flex items-center gap-2 text-violet-200/90">
          <Clock className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-widest text-violet-100/80">
            Daily limit
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
            Your daily screen time is finished! Ask a parent to help you finish up.
          </h2>

          {!parentVerified ? (
            <Button
              type="button"
              className="min-w-[180px] gap-2"
              onClick={() => setPinOpen(true)}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Parent PIN
            </Button>
          ) : (
            <Button type="button" className="min-w-[180px]" onClick={handleSnooze}>
              Snooze (+{DAILY_WATCH_SNOOZE_MINUTES} minutes)
            </Button>
          )}
        </div>
      </div>

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onVerified={() => {
          setPinOpen(false)
          setParentVerified(true)
        }}
        verifyPin={verifyParentPin}
        title="Parent verification"
        description="Enter the parent PIN to unlock extra watch time for today."
      />
    </>
  )
}
