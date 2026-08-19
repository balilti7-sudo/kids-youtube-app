import { useState } from 'react'
import { Bookmark, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import {
  getSavedActivePlaylistId,
  getSavedActivePlaylistName,
} from '../../lib/activePlaylistSelection'
import type { PlaylistVideoPayload, UserPlaylist } from '../../lib/playlists'
import {
  addVideoToPlaylistForChild,
  addVideoToPlaylistViaRpc,
} from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { AddToPlaylistModal } from './AddToPlaylistModal'
import { LoadingSpinner } from '../ui/LoadingSpinner'

type Props = {
  mode: PlaylistMode
  userId: string | null
  childAccessToken: string | null
  video: PlaylistVideoPayload
  /** Preloaded playlists — modal opens instantly. */
  initialPlaylists?: UserPlaylist[]
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
  initialPlaylists,
  compact,
  variant = 'default',
  className,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(false)
  const [quickAdding, setQuickAdding] = useState(false)

  const tryQuickAddToActive = async (): Promise<boolean> => {
    if (variant !== 'save') return false

    const playlistId = getSavedActivePlaylistId()
    if (!playlistId) return false

    const canAdd =
      mode === 'parent' ? Boolean(userId) : Boolean(childAccessToken)
    if (!canAdd) return false

    setQuickAdding(true)
    const res =
      mode === 'parent' && userId
        ? await addVideoToPlaylistViaRpc(playlistId, video)
        : childAccessToken
          ? await addVideoToPlaylistForChild(childAccessToken, playlistId, video)
          : { error: new Error('לא מחובר') }
    setQuickAdding(false)

    if (res.error) {
      if (res.error.message.includes('PLAYLIST_NOT_FOUND')) {
        return false
      }
      toast.error('לא ניתן להוסיף לפלייליסט', { description: res.error.message })
      return true
    }

    const name = getSavedActivePlaylistName()
    toast.success(name ? `נוסף ל"${name}"` : 'נוסף לפלייליסט')
    onAdded?.()
    return true
  }

  return (
    <>
      <button
        type="button"
        aria-label={variant === 'save' ? 'שמירה' : 'הוסף לפלייליסט'}
        title={variant === 'save' ? 'שמירה לפלייליסט' : 'הוסף לפלייליסט'}
        disabled={quickAdding}
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-semibold text-yt-text transition',
          variant === 'save'
            ? 'h-9 gap-2 rounded-full bg-yt-surfaceHover px-3.5 text-sm hover:bg-[#3f3f3f]/80'
            : compact
              ? 'min-h-[40px] min-w-[40px] gap-1.5 rounded-full border border-yt-border bg-yt-surface px-2 text-xs hover:bg-yt-surfaceHover'
              : 'min-h-[44px] gap-1.5 rounded-full border border-yt-border bg-yt-surface px-4 text-sm hover:bg-yt-surfaceHover',
          quickAdding && 'opacity-70',
          className
        )}
        onClick={(e) => {
          e.stopPropagation()
          void (async () => {
            const handled = await tryQuickAddToActive()
            if (!handled) setOpen(true)
          })()
        }}
      >
        {quickAdding ? (
          <LoadingSpinner className="h-4 w-4 shrink-0" />
        ) : variant === 'save' ? (
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
        initialPlaylists={initialPlaylists}
        video={video}
        onSuccess={onAdded}
      />
    </>
  )
}
