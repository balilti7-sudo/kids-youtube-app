import { isVideoShortOrSuspected, type VideoFormat } from './videoFormatClassification'

type Shortish = {
  format?: VideoFormat
  title?: string | null
  durationSeconds?: number | null
  youtubeVideoId?: string | null
  youtube_video_id?: string | null
  thumbnail_url?: string | null
  thumbnail?: string | null
  watchUrl?: string | null
}

export function itemLooksLikeShort(item: Shortish): boolean {
  return isVideoShortOrSuspected({
    format: item.format,
    title: item.title,
    durationSeconds: item.durationSeconds,
    youtubeVideoId: item.youtubeVideoId ?? item.youtube_video_id,
    thumbnail_url: item.thumbnail_url ?? item.thumbnail ?? null,
    watchUrl: item.watchUrl,
  })
}

/**
 * While watching a Short, next/prev (and swipe) should stay in the Shorts queue —
 * same feel as YouTube Shorts, instead of jumping into long-form videos.
 */
export function buildShortsAwareNavQueue<T extends Shortish>(
  items: T[],
  activeItem: T | null | undefined
): T[] {
  if (!activeItem || !itemLooksLikeShort(activeItem)) return items
  const shorts = items.filter(itemLooksLikeShort)
  return shorts.length > 0 ? shorts : items
}
