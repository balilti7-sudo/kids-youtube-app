import { useCallback, useEffect, useState } from 'react'
import { ThumbsUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatLikeCountLabel } from '../../lib/formatYoutubeCount'

const LIKES_STORAGE_KEY = 'safetube_local_video_likes_v1'

function readLikedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(LIKES_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length === 11))
  } catch {
    return new Set()
  }
}

function writeLikedSet(ids: Set<string>) {
  try {
    localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

type Props = {
  videoId: string
  /** Public YouTube like count (display only; local toggle is separate). */
  likeCount?: number | null
  className?: string
}

/**
 * YouTube-styled Like control. Local toggle only (no OAuth) — kids stay inside SafeTube.
 * Shows the public like count when available.
 */
export function YoutubeLikeButton({ videoId, likeCount, className }: Props) {
  const [liked, setLiked] = useState(false)

  useEffect(() => {
    setLiked(readLikedSet().has(videoId))
  }, [videoId])

  const toggle = useCallback(() => {
    setLiked((prev) => {
      const next = !prev
      const set = readLikedSet()
      if (next) set.add(videoId)
      else set.delete(videoId)
      writeLikedSet(set)
      return next
    })
  }, [videoId])

  const displayCount = (likeCount ?? 0) + (liked ? 1 : 0)
  const label = formatLikeCountLabel(displayCount > 0 ? displayCount : likeCount)

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? 'הסר לייק' : 'לייק'}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition',
        liked
          ? 'bg-yt-text text-yt-bg'
          : 'bg-yt-surfaceHover text-yt-text hover:bg-zinc-600/80',
        className
      )}
    >
      <ThumbsUp className={cn('h-4 w-4', liked && 'fill-current')} aria-hidden />
      <span>{label || 'לייק'}</span>
    </button>
  )
}
