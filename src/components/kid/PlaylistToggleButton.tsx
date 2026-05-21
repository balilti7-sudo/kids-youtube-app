import { Plus, Star } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { PlaylistTogglePayload } from '../../lib/childPlaylist'

type Props = {
  inPlaylist: boolean
  busy?: boolean
  compact?: boolean
  onToggle: (payload: PlaylistTogglePayload) => Promise<{ error: Error | null }>
  payload: PlaylistTogglePayload
  className?: string
}

export function PlaylistToggleButton({
  inPlaylist,
  busy,
  compact,
  onToggle,
  payload,
  className,
}: Props) {
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={inPlaylist}
      aria-label={inPlaylist ? 'הסר מהפלייליסט' : 'הוסף לפלייליסט'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 font-bold transition disabled:opacity-60',
        compact ? 'min-h-[40px] px-2.5 text-xs' : 'min-h-[48px] px-3 text-sm',
        inPlaylist
          ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60'
          : 'border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-100 dark:hover:bg-brand-900/50',
        className
      )}
      onClick={(e) => {
        e.stopPropagation()
        void onToggle(payload)
      }}
    >
      {inPlaylist ? (
        <Star className={cn('shrink-0 fill-amber-500 text-amber-500', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      ) : (
        <Plus className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={2.5} aria-hidden />
      )}
      <span>{inPlaylist ? 'בפלייליסט' : 'הוסף לפלייליסט'}</span>
    </button>
  )
}
