import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { PlaylistVideoPayload } from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { AddToPlaylistModal } from './AddToPlaylistModal'

type Props = {
  mode: PlaylistMode
  userId: string | null
  childAccessToken: string | null
  video: PlaylistVideoPayload
  compact?: boolean
  className?: string
  onAdded?: () => void
}

export function AddToPlaylistButton({
  mode,
  userId,
  childAccessToken,
  video,
  compact,
  className,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="הוסף לפלייליסט"
        title="הוסף לפלייליסט"
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 border-brand-200 bg-brand-50 font-bold text-brand-800 transition hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-100',
          compact ? 'min-h-[40px] min-w-[40px] px-2 text-xs' : 'min-h-[48px] px-3 text-sm',
          className
        )}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Plus className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={2.5} aria-hidden />
        {!compact ? <span>הוסף לפלייליסט</span> : null}
      </button>
      <AddToPlaylistModal
        open={open}
        onClose={() => setOpen(false)}
        mode={mode}
        userId={userId}
        childAccessToken={childAccessToken}
        video={video}
        onSuccess={onAdded}
      />
    </>
  )
}
