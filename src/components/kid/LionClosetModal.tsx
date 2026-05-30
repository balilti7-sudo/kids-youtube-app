import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { LION_OUTFITS, isOutfitUnlocked, type LionOutfitId } from '../../data/lionOutfits'
import { XP_PER_LEVEL } from '../../lib/lionProgression'
import { spawnParticleBurstOnElement } from '../../lib/juicyUi/spawnParticleBurst'
import { useLionProgression } from '../../contexts/LionProgressionContext'
import { cn } from '../../lib/utils'
import { LionMascot } from './LionMascot'

type Props = {
  open: boolean
  onClose: () => void
}

export function LionClosetModal({ open, onClose }: Props) {
  const { level, xp, activeOutfitId, equipOutfit } = useLionProgression()

  if (!open) return null

  const xpPercent = Math.min(100, (xp / XP_PER_LEVEL) * 100)

  return createPortal(
    <div
      className="fixed inset-0 z-[215] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lion-closet-title"
      dir="rtl"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-b from-amber-950 via-zinc-900 to-zinc-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-300/90">האריה המתפתח</p>
            <h2 id="lion-closet-title" className="text-xl font-black text-white">
              ארון הבגדים של האריה
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              רמה {level} • {xp}/{XP_PER_LEVEL} XP
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-200 transition hover:bg-white/20"
            aria-label="סגור"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="px-4 pt-3 sm:px-5">
          <div className="h-3 overflow-hidden rounded-full bg-zinc-800 ring-1 ring-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400"
              initial={false}
              animate={{ width: `${xpPercent}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 20 }}
            />
          </div>
        </div>

        <div className="flex justify-center px-4 py-4 sm:px-5">
          <div className="w-full max-w-[200px] rounded-2xl bg-amber-500/10 p-2 ring-1 ring-amber-400/25">
            <LionMascot mood="celebrate" outfitId={activeOutfitId} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5 sm:px-5">
          <div className="grid grid-cols-2 gap-3">
            {LION_OUTFITS.map((outfit) => {
              const unlocked = isOutfitUnlocked(outfit, level)
              const active = activeOutfitId === outfit.id
              return (
                <button
                  key={outfit.id}
                  type="button"
                  disabled={!unlocked}
                  onClick={(e) => {
                    if (!unlocked) return
                    spawnParticleBurstOnElement(e.currentTarget)
                    equipOutfit(outfit.id as LionOutfitId)
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-2xl border p-3 text-center transition',
                    unlocked
                      ? 'border-amber-400/40 bg-zinc-900/80 hover:border-amber-300 hover:bg-zinc-800/90 active:scale-95'
                      : 'cursor-not-allowed border-zinc-700/60 bg-zinc-950/60 opacity-55',
                    active && unlocked && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950'
                  )}
                >
                  <span className="text-3xl" aria-hidden>
                    {outfit.emoji}
                  </span>
                  <span className="text-sm font-bold text-zinc-50">{outfit.title}</span>
                  <span className="text-[11px] leading-snug text-zinc-400">{outfit.subtitle}</span>
                  {!unlocked ? (
                    <span className="mt-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                      🔒 נפתח ברמה {outfit.unlockLevel}
                    </span>
                  ) : active ? (
                    <span className="mt-1 text-[10px] font-bold text-amber-300">לבוש פעיל ✓</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
