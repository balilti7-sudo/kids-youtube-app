import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Star } from 'lucide-react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import type { BedtimeTask, TreasureClaimResult } from '../../lib/childRuntime'
import { BEDTIME_ROUTINE_FORCE_ENABLED } from '../../lib/childRuntime'
import { spawnMassiveConfetti, spawnParticleBurstOnElement } from '../../lib/juicyUi/spawnParticleBurst'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

const WHEEL_SEGMENTS = [
  { points: 10, label: '10' },
  { points: 20, label: '20' },
  { points: 50, label: '50' },
  { points: 10, label: '10' },
  { points: 20, label: '20' },
  { points: 50, label: '50' },
] as const

const SEGMENT_DEG = 360 / WHEEL_SEGMENTS.length

function rotationForPoints(points: number): number {
  const matches = WHEEL_SEGMENTS.map((segment, index) =>
    segment.points === points ? index : -1
  ).filter((index) => index >= 0)
  const idx = matches[Math.floor(Math.random() * matches.length)] ?? 0
  const segmentCenter = idx * SEGMENT_DEG + SEGMENT_DEG / 2
  return 5 * 360 + (360 - segmentCenter)
}

type Props = {
  className?: string
  /** Tighter layout for the channel watch sidebar (~402px). */
  compact?: boolean
}

export function BedtimeRoutineZone({ className, compact = false }: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const ready = runtime?.ready ?? false

  const [confirmingTask, setConfirmingTask] = useState<BedtimeTask | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [spinCelebration, setSpinCelebration] = useState<number | null>(null)
  const [spinError, setSpinError] = useState<string | null>(null)
  const [claimingTreasure, setClaimingTreasure] = useState(false)
  const [treasureClaim, setTreasureClaim] = useState<TreasureClaimResult | null>(null)
  const [treasureModalOpen, setTreasureModalOpen] = useState(false)
  const [treasureError, setTreasureError] = useState<string | null>(null)

  const progressPercent = useMemo(() => {
    if (!bedtime?.treasureThreshold) return 0
    return Math.min(100, Math.round((bedtime.weeklyTotalPoints / bedtime.treasureThreshold) * 100))
  }, [bedtime?.weeklyTotalPoints, bedtime?.treasureThreshold])

  useEffect(() => {
    if (!ready || bedtime || !runtime?.refreshBedtimeState) return
    void runtime.refreshBedtimeState()
  }, [ready, bedtime, runtime])

  const handleConfirmTask = useCallback(
    async (task: BedtimeTask) => {
      const activeDeviceId = runtime?.activeDeviceId ?? null

      if (!activeDeviceId) {
        console.error('[BedtimeRoutineZone] onTaskToggle: no activeDeviceId', { task, runtime })
        setTaskError('נא לבחור פרופיל ילד כדי להתחיל בשגרה')
        return
      }

      if (!runtime?.confirmBedtimeTask) {
        console.error('[BedtimeRoutineZone] onTaskToggle: confirmBedtimeTask unavailable', {
          task,
          activeDeviceId,
        })
        setTaskError('שגיאת מערכת — רעננו את הדף ונסו שוב.')
        return
      }

      setTaskError(null)
      setConfirmingTask(task)

      try {
        console.info('[BedtimeRoutineZone] onTaskToggle start', { task, activeDeviceId })
        const { data, error } = await runtime.confirmBedtimeTask(task)

        if (error) {
          console.error('[BedtimeRoutineZone] onTaskToggle RPC failed', {
            task,
            activeDeviceId,
            message: error.message,
            error,
          })
          setTaskError(
            error.message === 'AUTH_SESSION_MISSING'
              ? 'יש להתחבר מחדש כדי לשמור את שגרת השינה.'
              : `לא הצלחנו לשמור — ${error.message}`
          )
          return
        }

        console.info('[BedtimeRoutineZone] onTaskToggle saved', { task, activeDeviceId, data })
        spawnParticleBurstOnElement(
          document.activeElement instanceof HTMLElement ? document.activeElement : document.body
        )
      } catch (err) {
        console.error('[BedtimeRoutineZone] onTaskToggle unexpected error', {
          task,
          activeDeviceId,
          err,
        })
        setTaskError('לא הצלחנו לשמור — שגיאה לא צפויה. פרטים בקונסול.')
      } finally {
        setConfirmingTask(null)
      }
    },
    [runtime]
  )

  const handleSpinWheel = useCallback(async () => {
    if (!runtime?.spinDailyWheel || spinning) return
    setSpinError(null)
    setSpinCelebration(null)
    setSpinning(true)

    const { data, error } = await runtime.spinDailyWheel()

    if (error) {
      setSpinning(false)
      setSpinError('הגלגל לא הסתובב — נסו שוב.')
      return
    }

    const points = data?.pointsWon ?? 10
    setWheelRotation((prev) => prev + rotationForPoints(points))

    window.setTimeout(() => {
      setSpinning(false)
      setSpinCelebration(points)
      spawnMassiveConfetti()
    }, 4200)
  }, [runtime, spinning])

  const handleClaimTreasure = useCallback(async () => {
    if (!runtime?.claimTreasureChest || claimingTreasure) return
    setTreasureError(null)
    setClaimingTreasure(true)
    const { data, error } = await runtime.claimTreasureChest()
    setClaimingTreasure(false)
    if (error) {
      setTreasureError('לא הצלחנו לפתוח את האוצר — נסו שוב.')
      return
    }
    if (data) {
      setTreasureClaim(data)
      setTreasureModalOpen(true)
      spawnMassiveConfetti()
    }
  }, [runtime, claimingTreasure])

  if (!ready) {
    return (
      <section
        className={cn(
          'rounded-3xl border border-indigo-400/20 bg-indigo-950/30 p-5 text-center',
          className
        )}
        dir="rtl"
        aria-busy="true"
      >
        <p className="text-sm font-medium text-indigo-200/80">טוען את שגרת השינה… 🌙</p>
      </section>
    )
  }

  if (!runtime?.activeDeviceId) {
    return (
      <section
        className={cn(
          'rounded-3xl border border-sky-400/25 bg-sky-950/30 p-5 text-center',
          className
        )}
        dir="rtl"
      >
        <p className="text-sm font-semibold text-sky-100">נא לבחור פרופיל ילד כדי להתחיל בשגרה</p>
        <p className="mt-2 text-xs leading-relaxed text-sky-200/75">
          בחרו פרופיל מהרשימה למעלה (החלף פרופיל) — ואז נשמור את המשימות והגלגל בבסיס הנתונים.
        </p>
      </section>
    )
  }

  if (!bedtime) {
    return (
      <section
        className={cn(
          'rounded-3xl border border-amber-400/30 bg-amber-950/30 p-5 text-center',
          className
        )}
        dir="rtl"
      >
        <p className="text-sm font-semibold text-amber-100">לא הצלחנו לטעון את שגרת השינה.</p>
        <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
          ודאו ש-migrations 042 ו-044 רצו ב-Supabase, ואז רעננו.
        </p>
        <Button
          type="button"
          className="mt-4 w-full justify-center font-bold"
          onClick={() => void runtime?.refreshBedtimeState()}
        >
          רענן
        </Button>
      </section>
    )
  }

  if (!BEDTIME_ROUTINE_FORCE_ENABLED && !bedtime.enabled) {
    return null
  }

  const showParentWait = bedtime.tasksCompleted && !bedtime.parentApproved && !bedtime.wheelSpun
  const showWheel = bedtime.canSpinWheel && !bedtime.wheelSpun
  const showSpunMessage = bedtime.wheelSpun
  const wheelSizeClass = compact ? 'h-40 w-40 sm:h-44 sm:w-44' : 'h-52 w-52 sm:h-56 sm:w-56'

  return (
    <>
      <section
        className={cn(
          'overflow-hidden rounded-3xl border border-indigo-400/25 bg-gradient-to-b from-indigo-950/80 via-violet-950/50 to-zinc-950/90 shadow-xl shadow-indigo-950/30 ring-1 ring-indigo-300/10',
          compact ? 'p-3' : 'p-4 sm:p-5',
          className
        )}
        dir="rtl"
        aria-label="שגרת שינה"
      >
        <header className={cn('text-center', compact ? 'mb-3' : 'mb-4')}>
          <div className="mb-1 flex items-center justify-center gap-1 text-amber-300/90" aria-hidden>
            <Star className="h-4 w-4 fill-current" />
            <Sparkles className="h-5 w-5" />
            <Star className="h-4 w-4 fill-current" />
          </div>
          <h2 className="text-xl font-black text-white sm:text-2xl">שגרת השינה שלי</h2>
          <p className="mt-1 text-sm text-indigo-200/80">בואו נסיים את הערב ונזכה בנקודות!</p>
        </header>

        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-bold text-indigo-100">משימות הערב</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TaskButton
                emoji="🪥"
                label="צחצחתי שיניים"
                done={bedtime.teethConfirmed}
                busy={confirmingTask === 'teeth'}
                onClick={() => void handleConfirmTask('teeth')}
              />
              <TaskButton
                emoji="🚽"
                label="הלכתי לשירותים"
                done={bedtime.bathroomConfirmed}
                busy={confirmingTask === 'bathroom'}
                onClick={() => void handleConfirmTask('bathroom')}
              />
            </div>
            {taskError ? (
              <p className="mt-2 text-center text-sm text-rose-300" role="alert">
                {taskError}
              </p>
            ) : null}
          </div>

          <div className="rounded-2xl border border-violet-400/20 bg-violet-950/35 p-4">
            <h3 className="mb-3 text-center text-sm font-bold text-violet-100">גלגל המזל היומי</h3>

            {!bedtime.tasksCompleted ? (
              <p className="text-center text-sm leading-relaxed text-violet-200/75">
                סמנו קודם את שתי המשימות למעלה — ואז נוכל לסובב! ✨
              </p>
            ) : showParentWait ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-amber-400/30 bg-amber-950/40 px-4 py-4 text-center"
              >
                <p className="text-base font-semibold leading-relaxed text-amber-100">
                  אמרת לאבא או אמא? מחכים שהם יאשרו עם הקוד הסודי שלהם! 🤫
                </p>
              </motion.div>
            ) : showSpunMessage ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl border border-emerald-400/30 bg-emerald-950/40 px-4 py-4 text-center"
              >
                <p className="text-lg font-black text-emerald-100">
                  כל הכבוד! נתראה מחר בערב 🌛
                </p>
                <p className="mt-2 text-sm font-semibold text-emerald-200/90">
                  זכית היום ב-{bedtime.wheelPointsToday} נקודות!
                </p>
              </motion.div>
            ) : showWheel ? (
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div
                    className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1"
                    aria-hidden
                  >
                    <div className="h-0 w-0 border-x-[14px] border-x-transparent border-b-[22px] border-b-amber-300 drop-shadow-lg" />
                  </div>
                  <motion.div
                    className={cn(
                      'relative rounded-full border-4 border-amber-200/40 shadow-2xl shadow-amber-950/50',
                      wheelSizeClass
                    )}
                    style={{
                      background: `conic-gradient(
                        #38bdf8 0deg 60deg,
                        #a78bfa 60deg 120deg,
                        #fb923c 120deg 180deg,
                        #38bdf8 180deg 240deg,
                        #a78bfa 240deg 300deg,
                        #fb923c 300deg 360deg
                      )`,
                    }}
                    animate={{ rotate: wheelRotation }}
                    transition={
                      spinning
                        ? { duration: 4.2, ease: [0.12, 0.85, 0.22, 1] }
                        : { duration: 0 }
                    }
                  >
                    <div className="absolute inset-3 rounded-full border-2 border-white/20 bg-zinc-950/90" />
                    {WHEEL_SEGMENTS.map((segment, index) => {
                      const angle = index * SEGMENT_DEG + SEGMENT_DEG / 2
                      return (
                        <span
                          key={`${segment.points}-${index}`}
                          className="absolute left-1/2 top-1/2 text-sm font-black text-white drop-shadow-md"
                          style={{
                            transform: `rotate(${angle}deg) translateY(-72px) rotate(-${angle}deg)`,
                          }}
                          aria-hidden
                        >
                          {segment.label}
                        </span>
                      )
                    })}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-xl shadow-lg ring-4 ring-amber-100/30">
                        🎡
                      </span>
                    </div>
                  </motion.div>
                </div>

                <AnimatePresence mode="wait">
                  {spinCelebration ? (
                    <motion.p
                      key="celebration"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-center text-2xl font-black text-amber-200"
                    >
                      יש! קיבלת {spinCelebration} נקודות! 🎉
                    </motion.p>
                  ) : (
                    <Button
                      key="spin-btn"
                      type="button"
                      disabled={spinning}
                      onClick={() => void handleSpinWheel()}
                      className="w-full max-w-xs justify-center py-3.5 text-base font-black"
                    >
                      {spinning ? 'סובב סובב… 🌀' : 'סובב אותי!'}
                    </Button>
                  )}
                </AnimatePresence>

                {spinError ? (
                  <p className="text-center text-sm text-rose-300" role="alert">
                    {spinError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-sky-400/20 bg-sky-950/30 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-sky-100">נקודות השבוע</h3>
              <p className="text-sm font-black text-sky-50">
                {bedtime.weeklyTotalPoints} / {bedtime.treasureThreshold}
              </p>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-800 ring-1 ring-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 via-violet-400 to-amber-400"
                initial={false}
                animate={{ width: `${progressPercent}%` }}
                transition={{ type: 'spring', stiffness: 180, damping: 22 }}
              />
            </div>

            <div className="mt-4 flex flex-col items-center gap-3">
              <motion.button
                type="button"
                disabled={
                  !bedtime.treasureEligible ||
                  bedtime.treasureClaimed ||
                  claimingTreasure
                }
                onClick={() => void handleClaimTreasure()}
                animate={
                  bedtime.treasureEligible && !bedtime.treasureClaimed
                    ? { y: [0, -8, 0], scale: [1, 1.05, 1] }
                    : { y: 0, scale: 1 }
                }
                transition={
                  bedtime.treasureEligible && !bedtime.treasureClaimed
                    ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.2 }
                }
                className={cn(
                  'relative flex flex-col items-center gap-1 rounded-2xl border px-6 py-4 transition',
                  bedtime.treasureEligible && !bedtime.treasureClaimed
                    ? 'cursor-pointer border-amber-300/50 bg-gradient-to-b from-amber-400/25 to-orange-500/20 shadow-lg shadow-amber-500/30 ring-2 ring-amber-300/40 hover:brightness-110'
                    : 'cursor-default border-zinc-600/40 bg-zinc-900/50 opacity-80',
                  claimingTreasure && 'opacity-60'
                )}
                aria-label={
                  bedtime.treasureClaimed
                    ? 'האוצר כבר נפתח השבוע'
                    : bedtime.treasureEligible
                      ? 'פתח את תיבת האוצר'
                      : 'תיבת האוצר השבועית'
                }
              >
                {bedtime.treasureEligible && !bedtime.treasureClaimed ? (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-2xl bg-amber-300/20 blur-md"
                    aria-hidden
                  />
                ) : null}
                <span className="relative text-4xl leading-none" aria-hidden>
                  {bedtime.treasureClaimed ? '🎁' : '🧰'}
                </span>
                <span className="relative text-sm font-bold text-zinc-100">
                  {bedtime.treasureClaimed
                    ? 'פתחת את האוצר השבוע! 🎉'
                    : bedtime.treasureEligible
                      ? 'לחצו לפתיחת האוצר!'
                      : bedtime.treasureWindowOpen
                        ? 'עוד קצת נקודות לאוצר…'
                        : 'האוצר נפתח ביום חמישי בערב 📦'}
                </span>
              </motion.button>

              {treasureError ? (
                <p className="text-center text-sm text-rose-300" role="alert">
                  {treasureError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {treasureModalOpen && treasureClaim
        ? createPortal(
            <div
              className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bedtime-treasure-title"
              dir="rtl"
              onClick={() => setTreasureModalOpen(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className="relative w-full max-w-md rounded-3xl border border-amber-400/40 bg-gradient-to-b from-amber-950 via-zinc-900 to-zinc-950 p-6 text-center shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <motion.div
                  animate={{ rotate: [0, -6, 6, 0], scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.2, repeat: 2, ease: 'easeInOut' }}
                  className="mx-auto mb-4 text-6xl"
                  aria-hidden
                >
                  🎁
                </motion.div>
                <h2 id="bedtime-treasure-title" className="text-2xl font-black text-amber-100">
                  {treasureClaim.treasurePrizeTitle}
                </h2>
                <p className="mt-3 text-base leading-relaxed text-zinc-200">
                  {treasureClaim.treasurePrizeDescription}
                </p>
                <p className="mt-4 text-sm font-semibold text-emerald-300">
                  אספת {treasureClaim.weeklyTotalPoints} נקודות השבוע — אתם מדהימים! ⭐
                </p>
                <Button
                  type="button"
                  className="mt-6 w-full justify-center py-3 font-bold"
                  onClick={() => setTreasureModalOpen(false)}
                >
                  יופי! תודה אבא ואמא 💛
                </Button>
              </motion.div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

type TaskButtonProps = {
  emoji: string
  label: string
  done: boolean
  busy: boolean
  onClick: () => void
}

function TaskButton({ emoji, label, done, busy, onClick }: TaskButtonProps) {
  return (
    <button
      type="button"
      disabled={done || busy}
      onClick={onClick}
      className={cn(
        'relative flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-4 text-center transition',
        done
          ? 'border-emerald-400/40 bg-emerald-950/50 ring-2 ring-emerald-400/30'
          : 'border-indigo-400/30 bg-indigo-950/50 hover:border-indigo-300/50 hover:bg-indigo-900/50 active:scale-[0.98]',
        (done || busy) && 'cursor-default',
        busy && !done && 'opacity-70'
      )}
    >
      {done ? (
        <span className="text-3xl leading-none" aria-hidden>
          ✅
        </span>
      ) : (
        <span className="text-3xl leading-none" aria-hidden>
          {emoji}
        </span>
      )}
      <span className={cn('text-sm font-bold', done ? 'text-emerald-100' : 'text-indigo-50')}>
        {done ? 'סיימתי!' : label}
      </span>
    </button>
  )
}
