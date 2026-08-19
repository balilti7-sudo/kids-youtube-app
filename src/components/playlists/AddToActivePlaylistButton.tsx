import { useCallback, useEffect, useState } from 'react'
import { ListMusic, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import {
  ACTIVE_PLAYLIST_CHANGED_EVENT,
  getSavedActivePlaylistId,
  getSavedActivePlaylistName,
} from '../../lib/activePlaylistSelection'
import { addVideoToPlaylistViaRpc, type PlaylistVideoPayload } from '../../lib/playlists'
import { LoadingSpinner } from '../ui/LoadingSpinner'

type Props = {
  userId: string | null
  video: PlaylistVideoPayload
  compact?: boolean
  className?: string
  onAdded?: () => void
}

export function AddToActivePlaylistButton({
  userId,
  video,
  compact,
  className,
  onAdded,
}: Props) {
  const [activePlaylistName, setActivePlaylistName] = useState<string | null>(() =>
    getSavedActivePlaylistName()
  )
  const [adding, setAdding] = useState(false)

  const refreshActivePlaylist = useCallback(() => {
    const savedId = getSavedActivePlaylistId()
    if (!savedId) {
      setActivePlaylistName(null)
      return
    }
    setActivePlaylistName(getSavedActivePlaylistName())
  }, [])

  useEffect(() => {
    refreshActivePlaylist()
  }, [refreshActivePlaylist])

  useEffect(() => {
    const handler = () => refreshActivePlaylist()
    window.addEventListener(ACTIVE_PLAYLIST_CHANGED_EVENT, handler)
    return () => window.removeEventListener(ACTIVE_PLAYLIST_CHANGED_EVENT, handler)
  }, [refreshActivePlaylist])

  const handleAdd = async () => {
    if (!userId) {
      toast.error('לא מחובר')
      return
    }

    const playlistId = getSavedActivePlaylistId()
    if (!playlistId) {
      toast.error('חובה לפתוח פלייליסט לפני הוספת סרטונים בודדים')
      return
    }

    const playlistName = getSavedActivePlaylistName()
    setAdding(true)

    const { error } = await addVideoToPlaylistViaRpc(playlistId, video)
    setAdding(false)

    if (error) {
      if (error.message.includes('PLAYLIST_NOT_FOUND')) {
        toast.error('חובה לפתוח פלייליסט לפני הוספת סרטונים בודדים')
        return
      }
      toast.error('לא ניתן להוסיף לפלייליסט', { description: error.message })
      return
    }

    toast.success(playlistName ? `נוסף ל"${playlistName}"` : 'נוסף לפלייליסט')
    onAdded?.()
  }

  return (
    <button
      type="button"
      aria-label="הוסף לפלייליסט"
      title={
        activePlaylistName
          ? `הוסף ל"${activePlaylistName}"`
          : 'פתחו פלייליסט בלשונית הפלייליסטים לפני הוספה'
      }
      disabled={adding || !userId}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-yt-border bg-yt-surface font-semibold text-yt-text transition hover:bg-yt-surfaceHover disabled:cursor-not-allowed disabled:opacity-50',
        compact ? 'min-h-[40px] min-w-[40px] px-2 text-xs' : 'min-h-[44px] px-4 text-sm',
        className
      )}
      onClick={(e) => {
        e.stopPropagation()
        void handleAdd()
      }}
    >
      {adding ? (
        <LoadingSpinner className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      ) : activePlaylistName ? (
        <ListMusic className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      ) : (
        <Plus className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} strokeWidth={2.5} aria-hidden />
      )}
      {!compact ? <span>הוסף לפלייליסט</span> : null}
    </button>
  )
}
