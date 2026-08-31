import { fetchVideoDetailsBatch } from './youtube'

/** Classic Short length (vertical player / #shorts). */
export const SHORT_MAX_DURATION_SECONDS = 60
/**
 * YouTube channel “Videos” tab style: only clips longer than 3 minutes.
 * Anything at or under this goes to the Shorts shelf when duration is known.
 */
export const LONG_FORM_MIN_DURATION_SECONDS = 180

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
  // Do NOT match generic long-form thumbs (hq720 / hqdefault / maxresdefault / ardefault).
  if (
    u.includes('/shorts/') ||
    u.includes('oardefault') ||
    u.includes('oar2') ||
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
 * True when we are confident this is a YouTube Short (duration / #shorts / /shorts/ URL).
 * Used for playback layout, Shorts lane, and allow_shorts blocking — never thumbnail-only guesses
 * (those mis-route long channel uploads into a vertical player shell).
 */
export function isConfidentYoutubeShort(video: ShortClassificationFields): boolean {
  const url = (video.watchUrl ?? '').trim().toLowerCase()
  if (url.includes('/shorts/')) return true
  if (titleSuggestsYoutubeShort(video.title)) return true

  const duration = video.durationSeconds
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    return duration <= SHORT_MAX_DURATION_SECONDS
  }

  return false
}

/**
 * True when the item belongs on the Shorts shelf — includes suspected Shorts while duration is still loading.
 * Long-form shelf must use the inverse so vertical items never bleed into "סרטונים".
 */
export function isVideoShortOrSuspected(video: ShortClassificationFields): boolean {
  if (isConfidentYoutubeShort(video)) return true
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

/**
 * Same rule as the Shorts browse shelf: ≤ 3 minutes, or a Short signal while duration is unknown.
 * Playback (Shorts lane) must follow this — not the stricter 60s "confident Short" gate —
 * otherwise tapping a vertical card only marks it "playing" in the landscape player.
 */
export function belongsOnShortsShelf(
  video: ShortClassificationFields,
  portraitThumbnailIds?: ReadonlySet<string>
): boolean {
  const duration = video.durationSeconds
  const durationKnown = duration != null && Number.isFinite(duration) && duration > 0
  if (durationKnown) return duration <= LONG_FORM_MIN_DURATION_SECONDS
  if (isVideoShortOrSuspected(video)) return true
  const id = video.youtubeVideoId
  return Boolean(id && portraitThumbnailIds?.has(id))
}

export function buildYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

/** Marks the item as a Short for classification even before duration is known. */
export function buildYoutubeShortsUrl(videoId: string): string {
  return `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`
}

export type LiveBroadcastContent = 'none' | 'live' | 'upcoming'

export type WatchableVideoBase = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  durationSeconds: number | null
  watchUrl: string | null
  format: VideoFormat
  viewCount?: number | null
  likeCount?: number | null
  /** ISO-8601 publish time when known. */
  publishedAt?: string | null
  liveBroadcastContent?: LiveBroadcastContent | null
}

export function toWatchableVideo(row: {
  youtube_video_id: string
  title: string
  thumbnail_url?: string | null
  duration_seconds?: number | null
  durationSeconds?: number | null
  watch_url?: string | null
  watchUrl?: string | null
  viewCount?: number | null
  likeCount?: number | null
  publishedAt?: string | null
  published_at?: string | null
  liveBroadcastContent?: LiveBroadcastContent | null
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
    viewCount: row.viewCount ?? null,
    likeCount: row.likeCount ?? null,
    publishedAt: row.publishedAt ?? row.published_at ?? null,
    liveBroadcastContent: row.liveBroadcastContent ?? null,
  }
}

/** Attach duration, public stats, live status, and format via YouTube Data API. */
export async function enrichVideosWithFormat(
  videos: Array<{
    youtube_video_id: string
    title: string
    thumbnail_url?: string | null
    durationSeconds?: number | null
    viewCount?: number | null
    likeCount?: number | null
    publishedAt?: string | null
    liveBroadcastContent?: LiveBroadcastContent | null
  }>
): Promise<WatchableVideoBase[]> {
  if (videos.length === 0) return []

  const ids = videos.map((v) => v.youtube_video_id)
  const details = await fetchVideoDetailsBatch(ids)

  return videos.map((row) => {
    const fromApi = details.get(row.youtube_video_id)
    return toWatchableVideo({
      youtube_video_id: row.youtube_video_id,
      title: row.title,
      thumbnail_url: row.thumbnail_url ?? null,
      durationSeconds: row.durationSeconds ?? fromApi?.durationSeconds ?? null,
      viewCount: row.viewCount ?? fromApi?.viewCount ?? null,
      likeCount: row.likeCount ?? fromApi?.likeCount ?? null,
      publishedAt: row.publishedAt ?? fromApi?.publishedAt ?? null,
      liveBroadcastContent: row.liveBroadcastContent ?? fromApi?.liveBroadcastContent ?? null,
    })
  })
}

/** Currently live, or title-marked live streams (for the Live tab). */
export function isLiveStreamVideo(video: WatchableVideoBase): boolean {
  if (video.liveBroadcastContent === 'live') return true
  if (video.liveBroadcastContent === 'upcoming') return false
  const t = (video.title ?? '').trim()
  if (!t) return false
  return (
    /\b(live|livestream|live stream)\b/i.test(t) ||
    /שידור\s*חי/.test(t) ||
    /🔴/.test(t)
  )
}

export function partitionVideosForBrowse<T extends WatchableVideoBase>(
  videos: T[],
  portraitThumbnailIds?: ReadonlySet<string>
) {
  const longForm: T[] = []
  const shorts: T[] = []
  for (const video of videos) {
    const duration = video.durationSeconds
    const durationKnown = duration != null && Number.isFinite(duration) && duration > 0

    // Known length: Videos = over 3 minutes; Shorts = 3 minutes or less (YouTube-like).
    if (durationKnown) {
      if (duration > LONG_FORM_MIN_DURATION_SECONDS) longForm.push(video)
      else shorts.push(video)
      continue
    }

    if (isVideoShortOrSuspected(video)) {
      shorts.push(video)
      continue
    }

    // Portrait probe is a weak guess — never yank a known long-form video off Videos.
    if (portraitThumbnailIds?.has(video.youtube_video_id)) {
      shorts.push(video)
      continue
    }

    // Duration still loading and no Short signal — keep on Videos until enrich moves it.
    longForm.push(video)
  }
  return { longForm, shorts }
}

export function partitionVideosByFormat<T extends WatchableVideoBase>(videos: T[]) {
  return partitionVideosForBrowse(videos)
}

/** Reuse previous row objects when enrich/reload did not change visible fields — stops list flicker. */
export function stabilizeWatchableVideoList<T extends WatchableVideoBase>(
  prev: T[],
  next: T[]
): T[] {
  if (prev.length === 0) return next
  if (next.length === 0) return prev.length === 0 ? prev : next

  const prevById = new Map(prev.map((v) => [v.youtube_video_id, v]))
  let changed = prev.length !== next.length

  const out = next.map((n, index) => {
    const p = prevById.get(n.youtube_video_id)
    if (!p) {
      changed = true
      return n
    }
    if (prev[index]?.youtube_video_id !== n.youtube_video_id) changed = true
    if (
      p.title === n.title &&
      p.thumbnail_url === n.thumbnail_url &&
      p.durationSeconds === n.durationSeconds &&
      p.format === n.format &&
      p.viewCount === n.viewCount &&
      p.likeCount === n.likeCount &&
      p.publishedAt === n.publishedAt &&
      p.liveBroadcastContent === n.liveBroadcastContent &&
      p.watchUrl === n.watchUrl
    ) {
      return p
    }
    changed = true
    return n
  })

  return changed ? out : prev
}

/** Drop Shorts from a list when the device policy disables them. */
export function filterVideosRespectingAllowShorts<T extends ShortClassificationFields>(
  videos: T[],
  allowShorts: boolean
): T[] {
  // Shorts blocking is off app-wide — always keep Shorts in browse/search lists.
  void allowShorts
  return videos
}
