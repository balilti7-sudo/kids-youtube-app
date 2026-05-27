import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Award, Gift, Sparkles, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { Button } from '../ui/Button'
import { useChildProofLongPress } from '../../hooks/useChildProofLongPress'
import { readLocalParentSession } from '../../lib/localParentAdmin'
import { spawnMassiveConfetti } from '../../lib/juicyUi/spawnParticleBurst'
import { pinsMatch } from '../../lib/parentPin'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { useAuth } from '../../hooks/useAuth'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { cn } from '../../lib/utils'

type ModalPhase = 'challenge' | 'reward'

type Props = {
  task: string
  onChallengeComplete: () => void
}

export function ScreenTimeGiftChallengeModal({ task, onChallengeComplete }: Props) {
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const [phase, setPhase] = useState<ModalPhase>('challenge')
  const [pinOpen, setPinOpen] = useState(false)

  const localPin = readLocalParentSession()?.pin?.trim() ?? ''
  const usePinFlow = localPin.length >= 4

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

  const showReward = useCallback(() => {
    spawnMassiveConfetti()
    setPhase('reward')
    window.setTimeout(() => {
      onChallengeComplete()
    }, 3000)
  }, [onChallengeComplete])

  const longPress = useChildProofLongPress({
    enabled: !usePinFlow && phase === 'challenge',
    durationMs: 3000,
    onComplete: showReward,
  })

  const floatingShapes = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        id: i,
        left: 8 + (i * 11) % 82,
        delay: i * 0.35,
        size: 10 + (i % 3) * 6,
      })),
    []
  )

  useEffect(() => {
    if (phase !== 'reward') return
    spawnMassiveConfetti()
  }, [phase])

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/95 p-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-challenge-title"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {floatingShapes.map((shape) => (
            <motion.span
              key={shape.id}
              className="absolute rounded-full bg-gradient-to-br from-sky-400/40 to-amber-300/30"
              style={{ left: `${shape.left}%`, top: `${12 + (shape.id % 4) * 18}%`, width: shape.size, height: shape.size }}
              animate={{ y: [0, -18, 0], opacity: [0.35, 0.75, 0.35], scale: [1, 1.15, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, delay: shape.delay, ease: 'easeInOut' }}
            />
          ))}
        </div>

        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 w-full max-w-md rounded-3xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 text-center shadow-2xl shadow-black/40"
        >
          {phase === 'challenge' ? (
            <>
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 shadow-lg shadow-orange-950/50 ring-4 ring-amber-200/30"
              >
                <Gift className="h-12 w-12 text-white drop-shadow" strokeWidth={2} aria-hidden />
              </motion.div>
              <div className="mb-2 flex justify-center gap-1 text-amber-300/90" aria-hidden>
                <Star className="h-4 w-4 fill-current" />
                <Sparkles className="h-5 w-5" />
                <Star className="h-4 w-4 fill-current" />
              </div>
              <h2 id="gift-challenge-title" className="text-xl font-black text-zinc-50">
                משימה סודית!
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                כדי לנעול את הטאבלט ולשמור את הנקודות שלך, יש לך משימה סודית מחוץ למסך! בצע את המשימה והבא את
                המכשיר לאבא או אמא.
              </p>
              <div className="mt-5 rounded-2xl border border-sky-500/30 bg-sky-950/40 px-4 py-4">
                <p className="text-base font-bold leading-snug text-sky-100">{task}</p>
              </div>
              <Button
                type="button"
                className={cn(
                  'mt-6 w-full justify-center py-3.5 text-base font-bold',
                  !usePinFlow && longPress.shaking && 'animate-child-proof-shake'
                )}
                {...(usePinFlow
                  ? { onClick: () => setPinOpen(true) }
                  : {
                      onPointerDown: longPress.handlers.onPointerDown,
                      onPointerUp: longPress.handlers.onPointerUp,
                      onPointerLeave: longPress.handlers.onPointerLeave,
                      onPointerCancel: longPress.handlers.onPointerCancel,
                      onClick: longPress.handlers.onClick,
                    })}
              >
                סיימתי את המשימה! (להורים בלבד)
              </Button>
              {!usePinFlow ? (
                <p className="mt-2 text-xs text-zinc-500">הורים: החזיקו את הכפתור 3 שניות לאישור</p>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">הורים: יידרש קוד הורה לאישור</p>
              )}
            </>
          ) : (
            <>
              <motion.div
                initial={{ scale: 0.5, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="mx-auto mb-4 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-500 shadow-xl shadow-amber-950/40 ring-4 ring-amber-100/40"
              >
                <Award className="h-14 w-14 text-amber-950" strokeWidth={2} aria-hidden />
              </motion.div>
              <h2 className="text-2xl font-black text-zinc-50">כל הכבוד!</h2>
              <p className="mt-2 text-base font-semibold text-amber-200/95">נתראה בפעם הבאה.</p>
              <p className="mt-4 text-sm text-zinc-400">המכשיר ננעל — הורים יכולים לפתוח סשן חדש ממסך הבקרה.</p>
            </>
          )}
        </motion.div>
      </div>

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        verifyPin={async (pin) => {
          if (localPin && pinsMatch(pin, localPin)) return { ok: true as const }
          return verifyParentPin(pin)
        }}
        onVerified={() => {
          setPinOpen(false)
          showReward()
        }}
        title="אימות הורה"
        description="הזינו את קוד ההורה כדי לאשר שהמשימה בוצעה."
      />
    </>,
    document.body
  )
}
