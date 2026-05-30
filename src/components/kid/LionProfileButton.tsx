import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { cn } from '../../lib/utils'
import { LionMascot } from './LionMascot'

type Props = {
  className?: string
}

/** Tap the lion avatar in the child header to open the outfit closet. */
export function LionProfileButton({ className }: Props) {
  const lion = useLionProgressionOptional()
  if (!lion) return null

  return (
    <button
      type="button"
      onClick={lion.openCloset}
      className={cn(
        'relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl',
        'border border-amber-400/40 bg-gradient-to-br from-amber-400/25 to-orange-500/20',
        'shadow-md shadow-amber-900/20 ring-1 ring-amber-300/30 transition',
        'hover:scale-105 hover:border-amber-300 active:scale-95',
        'focus-visible:outline focus-visible:ring-2 focus-visible:ring-amber-400',
        className
      )}
      aria-label={`ארון הבגדים של האריה — ${lion.progressLabel}`}
      title={lion.progressLabel}
    >
      <LionMascot mood="celebrate" outfitId={lion.activeOutfitId} compact className="pointer-events-none scale-[1.35]" />
      <span className="absolute -bottom-0.5 start-0.5 rounded-md bg-zinc-950/90 px-1 py-px text-[9px] font-black leading-none text-amber-300 ring-1 ring-amber-500/40">
        {lion.level}
      </span>
    </button>
  )
}
