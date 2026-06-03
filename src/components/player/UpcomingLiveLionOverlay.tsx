import { motion } from 'framer-motion'
import { Radio } from 'lucide-react'
import { LionMascot } from '../kid/LionMascot'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { UPCOMING_LIVE_LION_MESSAGE } from '../../lib/liveStreamPolicy'
import { cn } from '../../lib/utils'

type Props = {
  className?: string
  message?: string
}

/** Shown instead of the video element when a stream is an upcoming live broadcast. */
export function UpcomingLiveLionOverlay({
  className,
  message = UPCOMING_LIVE_LION_MESSAGE,
}: Props) {
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-amber-950/95 via-orange-950/90 to-zinc-950/95 px-6 text-center',
        className
      )}
      role="status"
      aria-live="polite"
      dir="ltr"
    >
      <div className="flex items-center gap-2 text-amber-200/90">
        <Radio className="h-5 w-5 animate-pulse" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-widest text-amber-100/80">Upcoming live</span>
        <Radio className="h-5 w-5 animate-pulse" aria-hidden />
      </div>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        className="max-w-[200px]"
      >
        <LionMascot mood="bounce" outfitId={outfitId} />
      </motion.div>

      <p className="max-w-sm text-base font-semibold leading-relaxed text-amber-50 drop-shadow-sm">
        {message}
      </p>
    </div>
  )
}
