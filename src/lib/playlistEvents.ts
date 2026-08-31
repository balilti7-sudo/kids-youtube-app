import type { PlaylistVideo, PlaylistVideoPayload } from './playlists'

export const PLAYLIST_VIDEO_ADDED_EVENT = 'safetube:playlist-video-added'

export type PlaylistVideoAddedDetail = {
  playlistIds: string[]
  video: PlaylistVideoPayload
}

export function playlistVideoFromPayload(
  payload: PlaylistVideoPayload,
  videoOrder = 1
): PlaylistVideo {
  return {
    youtube_video_id: payload.youtube_video_id,
    title: payload.title,
    thumbnail_url: payload.thumbnail_url ?? null,
    youtube_channel_id: payload.youtube_channel_id ?? null,
    channel_name: payload.channel_name ?? null,
    video_order: videoOrder,
    created_at: new Date().toISOString(),
  }
}

export function emitPlaylistVideoAdded(detail: PlaylistVideoAddedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYLIST_VIDEO_ADDED_EVENT, { detail }))
}

export function appendPlaylistVideoIfMissing(
  list: PlaylistVideo[],
  payload: PlaylistVideoPayload
): PlaylistVideo[] {
  const id = payload.youtube_video_id?.trim()
  if (!id) return list
  if (list.some((v) => v.youtube_video_id === id)) return list
  return [...list, playlistVideoFromPayload(payload, list.length + 1)]
}
