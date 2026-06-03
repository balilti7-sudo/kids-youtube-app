import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { LionMascot } from '../kid/LionMascot'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { GENERIC_PLAYBACK_ERROR_MESSAGE } from '../../lib/playerPlaybackErrors'
import { cn } from '../../lib/utils'

type Props = {
  className?: string
  message?: string
  onRetry?: () => void
}

/** Friendly fallback when playback fails (geo-block, private, bridge errors, etc.). */
export function PlayerErrorOverlay({
  className,
  message = GENERIC_PLAYBACK_ERROR_MESSAGE,
  onRetry,
}: Props) {
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-violet-950/95 via-zinc-950/95 to-black px-6 text-center',
        className
      )}
      role="alert"
      aria-live="polite"
      dir="ltr"
    >
      <Sparkles className="h-5 w-5 text-amber-200/50" aria-hidden />

      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        className="max-w-[200px]"
      >
        <LionMascot mood="worried" outfitId={outfitId} />
      </motion.div>

      <p className="max-w-sm text-base font-semibold leading-relaxed text-zinc-100 drop-shadow-sm">
        {message}
      </p>

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-amber-500/90 px-5 py-2 text-sm font-bold text-black transition hover:bg-amber-400"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
