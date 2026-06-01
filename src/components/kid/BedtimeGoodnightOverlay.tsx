import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Moon, Sparkles } from 'lucide-react'
import { LionMascot } from './LionMascot'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { Button } from '../ui/Button'
import { spawnMassiveConfetti } from '../../lib/juicyUi/spawnParticleBurst'

type Props = {
  open: boolean
  onClose: () => void
  /** Points from tonight's wheel spin (optional). */
  pointsWon?: number | null
  /** Parent preview — skip confetti if desired */
  preview?: boolean
}

/**
 * Full-screen "goodnight" moment with the SafeTube lion mascot.
 * (This component did not exist in older builds — only inline text in BedtimeRoutineZone.)
 */
export function BedtimeGoodnightOverlay({ open, onClose, pointsWon, preview = false }: Props) {
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'

  useEffect(() => {
    if (!open || preview) return
    spawnMassiveConfetti()
  }, [open, preview])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[225] flex items-center justify-center bg-gradient-to-b from-indigo-950/95 via-violet-950/95 to-zinc-950/98 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bedtime-goodnight-title"
      dir="rtl"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.88, y: 28 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="relative w-full max-w-md rounded-3xl border border-indigo-300/25 bg-gradient-to-b from-indigo-950/90 via-violet-950/80 to-zinc-950/90 p-6 text-center shadow-2xl shadow-indigo-950/50 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl" aria-hidden>
          {[12, 28, 44, 60, 76].map((top) => (
            <Sparkles
              key={top}
              className="absolute h-4 w-4 text-amber-200/40"
              style={{ top: `${top}%`, left: `${(top * 7) % 90}%` }}
            />
          ))}
        </div>

        <div className="mb-2 flex items-center justify-center gap-2 text-indigo-200/90">
          <Moon className="h-6 w-6 text-amber-200" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-widest">
            {preview ? 'תצוגה מקדימה' : 'שגרת שינה'}
          </span>
          <Moon className="h-6 w-6 text-amber-200" aria-hidden />
        </div>

        <motion.div
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto mb-4 max-w-[200px]"
        >
          <LionMascot mood="celebrate" outfitId={outfitId} />
        </motion.div>

        <motion.h2
          id="bedtime-goodnight-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="text-3xl font-black text-amber-100 sm:text-4xl"
        >
          לילה טוב! 🌙
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-3 text-base font-semibold leading-relaxed text-indigo-100/95"
        >
          גור האריה גאה בכם — נתראה מחר בערב!
        </motion.p>

        {typeof pointsWon === 'number' && pointsWon > 0 ? (
          <p className="mt-2 text-sm font-bold text-emerald-300/95">זכיתם היום ב-{pointsWon} נקודות ⭐</p>
        ) : null}

        {preview ? (
          <p className="mt-3 text-xs text-indigo-300/70">כך הילדים יראו את המסך אחרי סיבוב הגלגל.</p>
        ) : null}

        <Button type="button" className="mt-6 w-full justify-center py-3 font-bold" onClick={onClose}>
          {preview ? 'סגור תצוגה מקדימה' : 'לילה טוב, נתראה מחר 💤'}
        </Button>
      </motion.div>
    </div>,
    document.body
  )
}
