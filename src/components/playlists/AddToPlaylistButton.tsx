import { useState } from 'react'
import { Bookmark, Plus } from 'lucide-react'
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
  /** YouTube watch-page Save pill (bookmark + שמירה). */
  variant?: 'default' | 'save'
  className?: string
  onAdded?: () => void
}

export function AddToPlaylistButton({
  mode,
  userId,
  childAccessToken,
  video,
  compact,
  variant = 'default',
  className,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label={variant === 'save' ? 'שמירה' : 'הוסף לפלייליסט'}
        title={variant === 'save' ? 'שמירה לפלייליסט' : 'הוסף לפלייליסט'}
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-semibold text-yt-text transition',
          variant === 'save'
            ? 'h-9 gap-2 rounded-full bg-yt-surfaceHover px-3.5 text-sm hover:bg-[#3f3f3f]/80'
            : compact
              ? 'min-h-[40px] min-w-[40px] gap-1.5 rounded-full border border-yt-border bg-yt-surface px-2 text-xs hover:bg-yt-surfaceHover'
              : 'min-h-[44px] gap-1.5 rounded-full border border-yt-border bg-yt-surface px-4 text-sm hover:bg-yt-surfaceHover',
          className
        )}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {variant === 'save' ? (
          <Bookmark className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Plus className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={2.5} aria-hidden />
        )}
        {variant === 'save' ? <span>שמירה</span> : !compact ? <span>הוסף לפלייליסט</span> : null}
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
