import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '../../lib/utils'
import { formatLikeCountLabel } from '../../lib/formatYoutubeCount'

const LIKES_STORAGE_KEY = 'safetube_local_video_likes_v1'
const DISLIKES_STORAGE_KEY = 'safetube_local_video_dislikes_v1'

function readIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length === 11))
  } catch {
    return new Set()
  }
}

function writeIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

function readLikedSet(): Set<string> {
  return readIdSet(LIKES_STORAGE_KEY)
}

function writeLikedSet(ids: Set<string>) {
  writeIdSet(LIKES_STORAGE_KEY, ids)
}

type Props = {
  videoId: string
  /** Public YouTube like count (display only; local toggle is separate). */
  likeCount?: number | null
  /** Compact icon+count for video grid cards. */
  compact?: boolean
  className?: string
}

/**
 * YouTube-styled Like control. Local toggle only (no OAuth) — kids stay inside SafeTube.
 * Shows the public like count when available.
 */
export function YoutubeLikeButton({ videoId, likeCount, compact = false, className }: Props) {
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)

  useEffect(() => {
    setLiked(readLikedSet().has(videoId))
    setDisliked(readIdSet(DISLIKES_STORAGE_KEY).has(videoId))
  }, [videoId])

  const toggle = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation()
      event?.preventDefault()
      setLiked((prev) => {
        const next = !prev
        const likes = readLikedSet()
        if (next) likes.add(videoId)
        else likes.delete(videoId)
        writeLikedSet(likes)
        if (next) {
          const dislikes = readIdSet(DISLIKES_STORAGE_KEY)
          dislikes.delete(videoId)
          writeIdSet(DISLIKES_STORAGE_KEY, dislikes)
          setDisliked(false)
        }
        return next
      })
    },
    [videoId]
  )

  const toggleDislike = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation()
      event?.preventDefault()
      setDisliked((prev) => {
        const next = !prev
        const dislikes = readIdSet(DISLIKES_STORAGE_KEY)
        if (next) dislikes.add(videoId)
        else dislikes.delete(videoId)
        writeIdSet(DISLIKES_STORAGE_KEY, dislikes)
        if (next) {
          const likes = readLikedSet()
          likes.delete(videoId)
          writeLikedSet(likes)
          setLiked(false)
        }
        return next
      })
    },
    [videoId]
  )

  const displayCount = (likeCount ?? 0) + (liked ? 1 : 0)
  const label = formatLikeCountLabel(displayCount > 0 ? displayCount : likeCount)

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => toggle(e)}
        aria-pressed={liked}
        aria-label={liked ? 'הסר לייק' : 'לייק'}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition',
          liked
            ? 'bg-yt-text text-yt-bg'
            : 'bg-yt-surfaceHover text-yt-text hover:bg-zinc-600/80',
          className
        )}
      >
        <ThumbsUp className={cn('h-3.5 w-3.5', liked && 'fill-current')} aria-hidden />
        <span>{label || ''}</span>
      </button>
    )
  }

  return (
    <div className={cn('inline-flex h-9 overflow-hidden rounded-full bg-yt-surfaceHover text-yt-text', className)}>
      <button
        type="button"
        onClick={(e) => toggle(e)}
        aria-pressed={liked}
        aria-label={liked ? 'הסר לייק' : 'לייק'}
        className="inline-flex items-center gap-2 px-3.5 text-sm font-semibold transition hover:bg-[#3f3f3f]/60"
      >
        <ThumbsUp className={cn('h-4 w-4', liked && 'fill-current')} aria-hidden />
        <span>{label || 'לייק'}</span>
      </button>
      <span className="my-1.5 w-px bg-yt-border" aria-hidden />
      <button
        type="button"
        onClick={(e) => toggleDislike(e)}
        aria-pressed={disliked}
        aria-label={disliked ? 'ביטול לא אהבתי' : 'לא אהבתי'}
        className="inline-flex items-center justify-center px-3 text-yt-text transition hover:bg-[#3f3f3f]/60"
      >
        <ThumbsDown className={cn('h-4 w-4', disliked && 'fill-current')} aria-hidden />
      </button>
    </div>
  )
}
