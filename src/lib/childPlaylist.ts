import { supabase } from './supabase'

export interface ChildPlaylistVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  youtube_channel_id: string | null
  channel_name: string | null
  position: number
  created_at: string
}

export type PlaylistTogglePayload = {
  youtube_video_id: string
  title: string
  thumbnail_url?: string | null
  youtube_channel_id?: string | null
  channel_name?: string | null
}

function mapPlaylistRow(row: Record<string, unknown>): ChildPlaylistVideo | null {
  const id = row.youtube_video_id ?? row.youtubeVideoId
  const title = row.title
  if (typeof id !== 'string' || typeof title !== 'string') return null
  return {
    youtube_video_id: id,
    title,
    thumbnail_url: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    youtube_channel_id:
      row.youtube_channel_id != null && row.youtube_channel_id !== ''
        ? String(row.youtube_channel_id)
        : null,
    channel_name:
      row.channel_name != null && row.channel_name !== '' ? String(row.channel_name) : null,
    position: typeof row.position === 'number' ? row.position : Number(row.position) || 0,
    created_at: row.created_at != null ? String(row.created_at) : '',
  }
}

export async function listChildPlaylist(accessToken: string): Promise<{
  data: ChildPlaylistVideo[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_playlist_list', {
    p_access_token: accessToken,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapPlaylistRow)
    .filter((r): r is ChildPlaylistVideo => r !== null)
  return { data: mapped, error: null }
}

export async function addChildPlaylistVideo(
  accessToken: string,
  payload: PlaylistTogglePayload
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('child_playlist_add', {
    p_access_token: accessToken,
    p_youtube_video_id: payload.youtube_video_id,
    p_title: payload.title,
    p_thumbnail_url: payload.thumbnail_url ?? null,
    p_youtube_channel_id: payload.youtube_channel_id ?? null,
    p_channel_name: payload.channel_name ?? null,
  })
  if (!error) return { error: null }
  const msg = error.message
  if (msg.includes('VIDEO_NOT_ON_APPROVED_CHANNEL')) {
    return { error: new Error('אפשר להוסיף רק סרטונים מערוצים מאושרים.') }
  }
  return { error: new Error(msg) }
}

export async function removeChildPlaylistVideo(
  accessToken: string,
  youtubeVideoId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('child_playlist_remove', {
    p_access_token: accessToken,
    p_youtube_video_id: youtubeVideoId,
  })
  return { error: error ? new Error(error.message) : null }
}
