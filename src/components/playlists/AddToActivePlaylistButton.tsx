import { useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { PlaylistVideoPayload, UserPlaylist } from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import {
  ACTIVE_PLAYLIST_CHANGED_EVENT,
  getSavedActivePlaylistId,
} from '../../lib/activePlaylistSelection'
import { useEffect } from 'react'
import { AddToPlaylistModal } from './AddToPlaylistModal'

type Props = {
  mode?: PlaylistMode
  userId: string | null
  childAccessToken?: string | null
  video: PlaylistVideoPayload
  initialPlaylists?: UserPlaylist[]
  compact?: boolean
  className?: string
  onAdded?: () => void
}

/**
 * Opens playlist-folder picker (never silent-add to the "active" playlist).
 */
export function AddToActivePlaylistButton({
  mode = 'parent',
  userId,
  childAccessToken = null,
  video,
  initialPlaylists,
  compact,
  className,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(false)
  const [preferredId, setPreferredId] = useState<string | null>(() => getSavedActivePlaylistId())

  useEffect(() => {
    const refresh = () => setPreferredId(getSavedActivePlaylistId())
    refresh()
    window.addEventListener(ACTIVE_PLAYLIST_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(ACTIVE_PLAYLIST_CHANGED_EVENT, refresh)
  }, [])

  return (
    <>
      <button
        type="button"
        aria-label="הוסף לפלייליסט"
        title="בחרו תיקיית פלייליסט להוספה"
        disabled={!userId && !childAccessToken}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-yt-border bg-yt-surface font-semibold text-yt-text transition hover:bg-yt-surfaceHover disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'min-h-[40px] min-w-[40px] px-2 text-xs' : 'min-h-[44px] px-4 text-sm',
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
        initialPlaylists={initialPlaylists}
        preferredPlaylistId={preferredId}
        video={video}
        onSuccess={onAdded}
      />
    </>
  )
}
