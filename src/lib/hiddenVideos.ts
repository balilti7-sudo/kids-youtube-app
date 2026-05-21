import { supabase } from './supabase'

export async function listHiddenVideoIdsForDevice(deviceId: string): Promise<{
  data: Set<string>
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('device_hidden_videos_list', {
    p_device_id: deviceId,
  })
  if (error) return { data: new Set(), error: new Error(error.message) }
  const ids = new Set(
    ((data ?? []) as { youtube_video_id: string }[]).map((r) => r.youtube_video_id)
  )
  return { data: ids, error: null }
}

export async function setVideoHiddenForDevice(
  deviceId: string,
  youtubeVideoId: string,
  hidden: boolean,
  youtubeChannelId?: string | null
): Promise<{ error: Error | null }> {
  if (hidden) {
    const { error } = await supabase.from('device_hidden_videos').insert({
      device_id: deviceId,
      youtube_video_id: youtubeVideoId,
      youtube_channel_id: youtubeChannelId ?? null,
    })
    if (error) {
      if (error.code === '23505') return { error: null }
      return { error: new Error(error.message) }
    }
    return { error: null }
  }

  const { error } = await supabase
    .from('device_hidden_videos')
    .delete()
    .eq('device_id', deviceId)
    .eq('youtube_video_id', youtubeVideoId)

  return { error: error ? new Error(error.message) : null }
}

export async function listHiddenVideoIdsLocalParent(
  accessToken: string,
  pin: string
): Promise<{ data: Set<string>; error: Error | null }> {
  const { data, error } = await supabase.rpc('local_parent_hidden_videos_list', {
    p_access_token: accessToken,
    p_pin: pin,
  })
  if (error) return { data: new Set(), error: new Error(error.message) }
  const ids = new Set(
    ((data ?? []) as { youtube_video_id: string }[]).map((r) => r.youtube_video_id)
  )
  return { data: ids, error: null }
}

export async function setVideoHiddenLocalParent(
  accessToken: string,
  pin: string,
  youtubeVideoId: string,
  hidden: boolean,
  youtubeChannelId?: string | null
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('local_parent_set_video_hidden', {
    p_access_token: accessToken,
    p_pin: pin,
    p_youtube_video_id: youtubeVideoId,
    p_hidden: hidden,
    p_youtube_channel_id: youtubeChannelId ?? null,
  })
  if (!error) return { error: null }
  const msg = error.message
  if (msg.includes('INVALID_PARENT_PIN')) return { error: new Error('קוד הורה שגוי') }
  return { error: new Error(msg) }
}
