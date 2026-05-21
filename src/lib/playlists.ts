import { supabase } from './supabase'

export interface UserPlaylist {
  id: string
  name: string
  video_count: number
  updated_at: string
}

export interface PlaylistVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  youtube_channel_id: string | null
  channel_name: string | null
  video_order: number
  created_at: string
}

export type PlaylistVideoPayload = {
  youtube_video_id: string
  title: string
  thumbnail_url?: string | null
  youtube_channel_id?: string | null
  channel_name?: string | null
}

function mapPlaylistRow(row: Record<string, unknown>): UserPlaylist | null {
  const id = row.id
  const name = row.name
  if (typeof id !== 'string' || typeof name !== 'string') return null
  return {
    id,
    name,
    video_count: Number(row.video_count ?? row.video_count ?? 0) || 0,
    updated_at: row.updated_at != null ? String(row.updated_at) : '',
  }
}

function mapVideoRow(row: Record<string, unknown>): PlaylistVideo | null {
  const id = row.youtube_video_id
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
    video_order:
      typeof row.video_order === 'number'
        ? row.video_order
        : Number(row.video_order ?? row.position) || 0,
    created_at: row.created_at != null ? String(row.created_at) : '',
  }
}

/** Parent (authenticated): list playlists */
export async function listPlaylistsForUser(userId: string): Promise<{
  data: UserPlaylist[]
  error: Error | null
}> {
  const { data, error } = await supabase
    .from('playlists')
    .select('id, name, updated_at, playlist_videos(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) return { data: [], error: new Error(error.message) }

  const mapped: UserPlaylist[] = (data ?? []).map((row) => {
    const r = row as {
      id: string
      name: string
      updated_at: string
      playlist_videos?: { count: number }[]
    }
    const count = r.playlist_videos?.[0]?.count ?? 0
    return { id: r.id, name: r.name, video_count: count, updated_at: r.updated_at }
  })
  return { data: mapped, error: null }
}

export async function createPlaylistForUser(
  userId: string,
  name: string
): Promise<{ data: UserPlaylist | null; error: Error | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { data: null, error: new Error('נא להזין שם לפלייליסט') }

  const { data, error } = await supabase
    .from('playlists')
    .insert({ user_id: userId, name: trimmed })
    .select('id, name, updated_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { data: null, error: new Error('כבר קיים פלייליסט בשם הזה') }
    }
    return { data: null, error: new Error(error.message) }
  }

  const row = data as { id: string; name: string; updated_at: string }
  return {
    data: { id: row.id, name: row.name, video_count: 0, updated_at: row.updated_at },
    error: null,
  }
}

export async function deletePlaylistForUser(playlistId: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('playlists').delete().eq('id', playlistId)
  return { error: error ? new Error(error.message) : null }
}

export async function listPlaylistVideos(playlistId: string): Promise<{
  data: PlaylistVideo[]
  error: Error | null
}> {
  const { data, error } = await supabase
    .from('playlist_videos')
    .select('youtube_video_id, title, thumbnail_url, youtube_channel_id, channel_name, video_order, created_at')
    .eq('playlist_id', playlistId)
    .order('video_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return { data: [], error: new Error(error.message) }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapVideoRow)
    .filter((r): r is PlaylistVideo => r !== null)
  return { data: mapped, error: null }
}

export async function addVideoToPlaylist(
  playlistId: string,
  payload: PlaylistVideoPayload
): Promise<{ error: Error | null }> {
  const { data: maxRow } = await supabase
    .from('playlist_videos')
    .select('video_order')
    .eq('playlist_id', playlistId)
    .order('video_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos =
    maxRow && typeof (maxRow as { video_order: number }).video_order === 'number'
      ? (maxRow as { video_order: number }).video_order + 1
      : 1

  const { error } = await supabase.from('playlist_videos').upsert(
    {
      playlist_id: playlistId,
      youtube_video_id: payload.youtube_video_id,
      title: payload.title,
      thumbnail_url: payload.thumbnail_url ?? null,
      youtube_channel_id: payload.youtube_channel_id ?? null,
      channel_name: payload.channel_name ?? null,
      video_order: nextPos,
    },
    { onConflict: 'playlist_id,youtube_video_id' }
  )

  if (!error) {
    await supabase.from('playlists').update({ updated_at: new Date().toISOString() }).eq('id', playlistId)
  }
  return { error: error ? new Error(error.message) : null }
}

export async function removeVideoFromPlaylist(
  playlistId: string,
  youtubeVideoId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('playlist_videos')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('youtube_video_id', youtubeVideoId)
  return { error: error ? new Error(error.message) : null }
}

export async function playlistIdsContainingVideo(
  userId: string,
  youtubeVideoId: string
): Promise<{ data: string[]; error: Error | null }> {
  const { data, error } = await supabase
    .from('playlist_videos')
    .select('playlist_id, playlists!inner(user_id)')
    .eq('youtube_video_id', youtubeVideoId)
    .eq('playlists.user_id', userId)

  if (error) return { data: [], error: new Error(error.message) }
  const ids = (data ?? []).map((r) => (r as { playlist_id: string }).playlist_id)
  return { data: ids, error: null }
}

/** Kid device: list playlists via RPC */
export async function listPlaylistsForChild(accessToken: string): Promise<{
  data: UserPlaylist[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_playlists_list', {
    p_access_token: accessToken,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapPlaylistRow)
    .filter((r): r is UserPlaylist => r !== null)
  return { data: mapped, error: null }
}

export async function createPlaylistForChild(
  accessToken: string,
  name: string
): Promise<{ data: string | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_playlist_create', {
    p_access_token: accessToken,
    p_name: name.trim(),
  })
  if (error) {
    const msg = error.message
    if (msg.includes('INVALID_PLAYLIST_NAME')) return { data: null, error: new Error('נא להזין שם') }
    if (msg.includes('PLAYLIST_NAME_TOO_LONG')) return { data: null, error: new Error('השם ארוך מדי') }
    return { data: null, error: new Error(msg) }
  }
  return { data: typeof data === 'string' ? data : null, error: null }
}

export async function listPlaylistVideosForChild(
  accessToken: string,
  playlistId: string
): Promise<{ data: PlaylistVideo[]; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_playlist_videos_list', {
    p_access_token: accessToken,
    p_playlist_id: playlistId,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapVideoRow)
    .filter((r): r is PlaylistVideo => r !== null)
  return { data: mapped, error: null }
}

export async function addVideoToPlaylistForChild(
  accessToken: string,
  playlistId: string,
  payload: PlaylistVideoPayload
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('child_playlist_add_video', {
    p_access_token: accessToken,
    p_playlist_id: playlistId,
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
  if (msg.includes('PLAYLIST_NOT_FOUND')) {
    return { error: new Error('הפלייליסט לא נמצא') }
  }
  return { error: new Error(msg) }
}

export async function removeVideoFromPlaylistForChild(
  accessToken: string,
  playlistId: string,
  youtubeVideoId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('child_playlist_remove_video', {
    p_access_token: accessToken,
    p_playlist_id: playlistId,
    p_youtube_video_id: youtubeVideoId,
  })
  return { error: error ? new Error(error.message) : null }
}

export async function playlistIdsContainingVideoForChild(
  accessToken: string,
  youtubeVideoId: string
): Promise<{ data: string[]; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_playlist_ids_for_video', {
    p_access_token: accessToken,
    p_youtube_video_id: youtubeVideoId,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const ids = ((data ?? []) as { playlist_id: string }[]).map((r) => r.playlist_id)
  return { data: ids, error: null }
}
