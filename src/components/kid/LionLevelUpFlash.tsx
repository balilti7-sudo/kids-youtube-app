import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { spawnMassiveConfetti } from '../../lib/juicyUi/spawnParticleBurst'
import { LionMascot } from './LionMascot'
import { useLionProgression } from '../../contexts/LionProgressionContext'

type Props = {
  level: number
  onDone: () => void
}

export function LionLevelUpFlash({ level, onDone }: Props) {
  const { activeOutfitId } = useLionProgression()

  useEffect(() => {
    spawnMassiveConfetti()
    const id = window.setTimeout(onDone, 2800)
    return () => window.clearTimeout(id)
  }, [onDone])

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[225] flex flex-col items-center justify-center bg-gradient-to-br from-amber-400/95 via-orange-500/95 to-rose-500/95 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="level-up-title"
      dir="rtl"
    >
      <motion.div
        initial={{ scale: 0.6, y: 40, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 16 }}
        className="flex max-w-sm flex-col items-center gap-4 text-center"
      >
        <Sparkles className="h-10 w-10 text-white drop-shadow-lg" aria-hidden />
        <h2 id="level-up-title" className="text-3xl font-black text-white drop-shadow-md sm:text-4xl">
          עלית רמה!
        </h2>
        <p className="text-lg font-bold text-white/95">רמה {level} — האריה שלך גדל!</p>
        <div className="w-full max-w-[200px] rounded-3xl bg-white/20 p-3 ring-2 ring-white/40">
          <LionMascot mood="celebrate" outfitId={activeOutfitId} />
        </div>
      </motion.div>
    </motion.div>,
    document.body
  )
}
