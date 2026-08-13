import {
  buildYoutubeWatchUrl,
  isVideoShortOrSuspected,
  type VideoFormat,
  classifyYoutubeVideo,
} from './videoFormatClassification'

/** Red-line: refuse Shorts when the profile has allow_shorts=false. */
export function isShortsBlockedForProfile(
  allowShorts: boolean | null | undefined,
  video: {
    title?: string | null
    durationSeconds?: number | null
    youtubeVideoId?: string | null
    thumbnail_url?: string | null
    format?: VideoFormat
  }
): boolean {
  if (allowShorts) return false
  return isVideoShortOrSuspected({
    title: video.title,
    durationSeconds: video.durationSeconds,
    watchUrl: video.youtubeVideoId ? buildYoutubeWatchUrl(video.youtubeVideoId) : null,
    youtubeVideoId: video.youtubeVideoId,
    thumbnail_url: video.thumbnail_url,
    format: video.format,
  })
}

/** Keep only YouTube search hits whose channel is on the device whitelist. */
export function filterSearchToWhitelistedChannels<T extends { channelId?: string | null }>(
  results: T[],
  allowedYoutubeChannelIds: Iterable<string>
): T[] {
  const allowed = new Set(
    [...allowedYoutubeChannelIds].map((id) => String(id || '').trim()).filter(Boolean)
  )
  if (allowed.size === 0) return []
  return results.filter((r) => {
    const id = String(r.channelId || '').trim()
    return Boolean(id) && allowed.has(id)
  })
}

export function classifyWatchFormat(video: {
  durationSeconds?: number | null
  youtubeVideoId?: string | null
  title?: string | null
  thumbnail?: string | null
}): VideoFormat {
  if (
    isVideoShortOrSuspected({
      title: video.title,
      durationSeconds: video.durationSeconds,
      youtubeVideoId: video.youtubeVideoId,
      thumbnail_url: video.thumbnail,
      watchUrl: video.youtubeVideoId ? buildYoutubeWatchUrl(video.youtubeVideoId) : null,
    })
  ) {
    return 'short'
  }
  return classifyYoutubeVideo({
    durationSeconds: video.durationSeconds,
    youtubeVideoId: video.youtubeVideoId,
    watchUrl: video.youtubeVideoId ? buildYoutubeWatchUrl(video.youtubeVideoId) : null,
  })
}
