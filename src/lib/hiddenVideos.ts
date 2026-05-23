import { supabase } from './supabase'

export type HiddenVideoRow = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  youtube_channel_id: string | null
  channel_name: string | null
  hidden_at: string
}

export type HiddenVideoPayload = {
  youtube_video_id: string
  title: string
  thumbnail_url?: string | null
  youtube_channel_id?: string | null
  channel_name?: string | null
}

function mapHiddenRow(row: Record<string, unknown>): HiddenVideoRow | null {
  const id = row.youtube_video_id
  if (typeof id !== 'string') return null
  return {
    youtube_video_id: id,
    title: typeof row.title === 'string' ? row.title : id,
    thumbnail_url: row.thumbnail_url != null ? String(row.thumbnail_url) : null,
    youtube_channel_id:
      row.youtube_channel_id != null && row.youtube_channel_id !== ''
        ? String(row.youtube_channel_id)
        : null,
    channel_name:
      row.channel_name != null && row.channel_name !== '' ? String(row.channel_name) : null,
    hidden_at: row.hidden_at != null ? String(row.hidden_at) : '',
  }
}

export async function listHiddenVideosForDevice(deviceId: string): Promise<{
  data: HiddenVideoRow[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('device_hidden_videos_list_details', {
    p_device_id: deviceId,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapHiddenRow)
    .filter((r): r is HiddenVideoRow => r !== null)
  return { data: mapped, error: null }
}

export async function listHiddenVideosLocalParent(
  accessToken: string,
  pin: string
): Promise<{ data: HiddenVideoRow[]; error: Error | null }> {
  const { data, error } = await supabase.rpc('local_parent_hidden_videos_list_details', {
    p_access_token: accessToken,
    p_pin: pin,
  })
  if (error) {
    const msg = error.message
    if (msg.includes('INVALID_PARENT_PIN')) return { data: [], error: new Error('קוד הורה שגוי') }
    return { data: [], error: new Error(msg) }
  }
  const mapped = ((data ?? []) as Record<string, unknown>[])
    .map(mapHiddenRow)
    .filter((r): r is HiddenVideoRow => r !== null)
  return { data: mapped, error: null }
}

export async function listHiddenVideoIdsForDevice(deviceId: string): Promise<{
  data: Set<string>
  error: Error | null
}> {
  const { data, error } = await listHiddenVideosForDevice(deviceId)
  if (error) return { data: new Set(), error }
  return { data: new Set(data.map((v) => v.youtube_video_id)), error: null }
}

export async function listHiddenVideoIdsLocalParent(
  accessToken: string,
  pin: string
): Promise<{ data: Set<string>; error: Error | null }> {
  const { data, error } = await supabase.rpc('local_parent_hidden_videos_list', {
    p_access_token: accessToken,
    p_pin: pin,
  })
  if (error) {
    const msg = error.message
    if (msg.includes('INVALID_PARENT_PIN')) return { data: new Set(), error: new Error('קוד הורה שגוי') }
    return { data: new Set(), error: new Error(msg) }
  }
  const ids = new Set(
    ((data ?? []) as { youtube_video_id: string }[]).map((r) => r.youtube_video_id)
  )
  return { data: ids, error: null }
}

export async function setVideoHiddenAuthenticated(
  deviceId: string,
  pin: string,
  payload: HiddenVideoPayload,
  hidden: boolean
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('parent_set_video_hidden', {
    p_device_id: deviceId,
    p_pin: pin,
    p_youtube_video_id: payload.youtube_video_id,
    p_hidden: hidden,
    p_title: payload.title,
    p_thumbnail_url: payload.thumbnail_url ?? null,
    p_youtube_channel_id: payload.youtube_channel_id ?? null,
    p_channel_name: payload.channel_name ?? null,
  })
  if (!error) return { error: null }
  const msg = error.message
  if (msg.includes('INVALID_PARENT_PIN')) return { error: new Error('קוד הורה שגוי') }
  return { error: new Error(msg) }
}

export async function setVideoHiddenLocalParent(
  accessToken: string,
  pin: string,
  payload: HiddenVideoPayload,
  hidden: boolean
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('local_parent_set_video_hidden', {
    p_access_token: accessToken,
    p_pin: pin,
    p_youtube_video_id: payload.youtube_video_id,
    p_hidden: hidden,
    p_youtube_channel_id: payload.youtube_channel_id ?? null,
    p_title: payload.title,
    p_thumbnail_url: payload.thumbnail_url ?? null,
    p_channel_name: payload.channel_name ?? null,
  })
  if (!error) return { error: null }
  const msg = error.message
  if (msg.includes('INVALID_PARENT_PIN')) return { error: new Error('קוד הורה שגוי') }
  return { error: new Error(msg) }
}
