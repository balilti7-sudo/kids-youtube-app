import { fetchVideoDurationsBatch } from './youtube'

export const SHORT_MAX_DURATION_SECONDS = 90

export type VideoFormat = 'short' | 'long'

export type VideoFormatInput = {
  durationSeconds?: number | null
  watchUrl?: string | null
  youtubeVideoId?: string | null
}

/** Title/tags often mark Shorts before duration is cached. */
export function titleSuggestsYoutubeShort(title: string | null | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase()
  if (!t) return false
  return /#shorts?\b/.test(t) || /\bshorts\s*$/i.test(t) || /\bשורטס\b/.test(t)
}

/** Portrait preview URLs on ytimg usually indicate a Short. */
export function thumbnailSuggestsYoutubeShort(thumbnailUrl: string | null | undefined): boolean {
  const u = (thumbnailUrl ?? '').trim().toLowerCase()
  if (!u) return false
  if (
    u.includes('/shorts/') ||
    u.includes('oardefault') ||
    u.includes('oar2') ||
    u.includes('ardefault') ||
    u.includes('hq720') ||
    (u.includes('ytimg.com') && u.includes('vi_webp') && u.includes('oar'))
  ) {
    return true
  }

  const wMatch = u.match(/(?:[?&](?:width|w)=)(\d+)/)
  const hMatch = u.match(/(?:[?&](?:height|h)=)(\d+)/)
  if (wMatch && hMatch) {
    const w = Number(wMatch[1])
    const h = Number(hMatch[1])
    if (w > 0 && h > 0 && h / w >= 1.12) return true
  }

  return false
}

/** Classify as Short when duration ≤ 90s or URL contains /shorts/. */
export function classifyYoutubeVideo(input: VideoFormatInput): VideoFormat {
  const url = (input.watchUrl ?? '').trim().toLowerCase()
  if (url.includes('/shorts/')) return 'short'

  const duration = input.durationSeconds
  if (duration != null && Number.isFinite(duration) && duration > 0 && duration <= SHORT_MAX_DURATION_SECONDS) {
    return 'short'
  }

  return 'long'
}

type ShortClassificationFields = VideoFormatInput & {
  format?: VideoFormat
  title?: string | null
  thumbnail_url?: string | null
}

/**
 * True when the item belongs on the Shorts shelf — includes suspected Shorts while duration is still loading.
 * Long-form shelf must use the inverse so vertical items never bleed into "סרטונים".
 */
export function isVideoShortOrSuspected(video: ShortClassificationFields): boolean {
  if (video.format === 'short') return true

  const classified = classifyYoutubeVideo({
    durationSeconds: video.durationSeconds,
    watchUrl: video.watchUrl,
    youtubeVideoId: video.youtubeVideoId,
  })
  if (classified === 'short') return true

  const duration = video.durationSeconds
  const durationKnown = duration != null && Number.isFinite(duration) && duration > 0
  if (durationKnown && duration > SHORT_MAX_DURATION_SECONDS) return false

  return titleSuggestsYoutubeShort(video.title) || thumbnailSuggestsYoutubeShort(video.thumbnail_url)
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

export type WatchableVideoBase = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  durationSeconds: number | null
  watchUrl: string | null
  format: VideoFormat
}

export function toWatchableVideo(row: {
  youtube_video_id: string
  title: string
  thumbnail_url?: string | null
  duration_seconds?: number | null
  durationSeconds?: number | null
  watch_url?: string | null
  watchUrl?: string | null
}): WatchableVideoBase {
  const durationSeconds = row.durationSeconds ?? row.duration_seconds ?? null
  const watchUrl = row.watchUrl ?? row.watch_url ?? buildYoutubeWatchUrl(row.youtube_video_id)
  return {
    youtube_video_id: row.youtube_video_id,
    title: row.title,
    thumbnail_url: row.thumbnail_url ?? null,
    durationSeconds,
    watchUrl,
    format: classifyYoutubeVideo({
      durationSeconds,
      watchUrl,
      youtubeVideoId: row.youtube_video_id,
    }),
  }
}

/** Attach duration (YouTube API batch) and format to cached rows when possible. */
export async function enrichVideosWithFormat(
  videos: Array<{ youtube_video_id: string; title: string; thumbnail_url?: string | null; durationSeconds?: number | null }>
): Promise<WatchableVideoBase[]> {
  if (videos.length === 0) return []

  const ids = videos.map((v) => v.youtube_video_id)
  const durations = await fetchVideoDurationsBatch(ids)

  return videos.map((row) => {
    const fromApi = durations.get(row.youtube_video_id)
    return toWatchableVideo({
      youtube_video_id: row.youtube_video_id,
      title: row.title,
      thumbnail_url: row.thumbnail_url ?? null,
      durationSeconds: row.durationSeconds ?? fromApi ?? null,
    })
  })
}

export function partitionVideosForBrowse<T extends WatchableVideoBase>(
  videos: T[],
  portraitThumbnailIds?: ReadonlySet<string>
) {
  const longForm: T[] = []
  const shorts: T[] = []
  for (const video of videos) {
    if (isVideoShortOrSuspected(video) || portraitThumbnailIds?.has(video.youtube_video_id)) {
      shorts.push(video)
    } else {
      longForm.push(video)
    }
  }
  return { longForm, shorts }
}

export function partitionVideosByFormat<T extends WatchableVideoBase>(videos: T[]) {
  return partitionVideosForBrowse(videos)
}
