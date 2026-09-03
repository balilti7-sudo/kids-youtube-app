import {
  buildYoutubeWatchUrl,
  classifyContentShape,
  isConfidentYoutubeShort,
  type ContentShapeInput,
  type VideoFormat,
} from './videoFormatClassification'
import { SHORTS_BLOCKING_ENABLED } from './parentalLimitsPolicy'

export { SHORTS_BLOCKING_ENABLED } from './parentalLimitsPolicy'

/** Red-line: refuse Shorts when the profile has allow_shorts=false (disabled while SHORTS_BLOCKING_ENABLED is false). */
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
  if (!SHORTS_BLOCKING_ENABLED) return false
  if (allowShorts) return false
  return isConfidentYoutubeShort({
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

/** @deprecated Prefer {@link classifyContentShape} from `videoFormatClassification`. */
export function classifyWatchFormat(video: ContentShapeInput): VideoFormat {
  return classifyContentShape(video)
}
