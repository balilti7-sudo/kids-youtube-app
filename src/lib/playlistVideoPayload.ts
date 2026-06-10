import type { PlaylistVideoPayload } from './playlists'
import type { YouTubeVideoResult } from '../types'

export function isValidYoutubeVideoId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value.trim())
}

/** Build playlist RPC/table payload from a YouTube search row (same shape as ChannelManager preview). */
export function playlistVideoPayloadFromSearchResult(
  video: Pick<YouTubeVideoResult, 'videoId' | 'title' | 'thumbnail' | 'channelTitle'> & {
    youtube_channel_id?: string | null
  }
): PlaylistVideoPayload | null {
  if (!isValidYoutubeVideoId(video.videoId)) return null
  const youtube_video_id = video.videoId.trim()
  return {
    youtube_video_id,
    title: video.title?.trim() || youtube_video_id,
    thumbnail_url: video.thumbnail?.trim() || null,
    youtube_channel_id: video.youtube_channel_id?.trim() || null,
    channel_name: video.channelTitle?.trim() || null,
  }
}
