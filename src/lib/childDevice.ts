import { supabase } from './supabase'

const CHILD_ACCESS_TOKEN_KEY = 'safetube_kid_access_token'

export interface ChildDeviceState {
  device_id: string
  device_name: string
  is_blocked: boolean
  is_online: boolean
  last_seen_at: string | null
}

export interface ChildAllowedVideo {
  device_id: string
  is_blocked: boolean
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
}

export interface ChildAllowedChannel {
  channel_id: string
  youtube_channel_id: string
  channel_name: string
  category: string | null
  channel_thumbnail: string | null
  subscriber_count: string | null
}

export interface ChildCachedChannelVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  published_at: string | null
}

export function getSavedChildAccessToken() {
  return localStorage.getItem(CHILD_ACCESS_TOKEN_KEY)
}

export function saveChildAccessToken(token: string) {
  localStorage.setItem(CHILD_ACCESS_TOKEN_KEY, token)
}

export function clearChildAccessToken() {
  localStorage.removeItem(CHILD_ACCESS_TOKEN_KEY)
}

export async function pairChildDevice(pairingCode: string): Promise<{
  accessToken: string | null
  deviceName: string | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_pair_device', {
    p_pairing_code: pairingCode.trim(),
  })

  if (error) return { accessToken: null, deviceName: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row?.access_token) return { accessToken: null, deviceName: null, error: new Error('קוד צימוד לא תקין או שפג תוקפו') }
  return { accessToken: String(row.access_token), deviceName: String(row.device_name ?? ''), error: null }
}

export async function getChildDeviceState(accessToken: string): Promise<{ data: ChildDeviceState | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_get_device_state', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: row as ChildDeviceState, error: null }
}

export async function getChildAllowedVideos(accessToken: string): Promise<{
  data: ChildAllowedVideo[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_allowed_videos', {
    p_access_token: accessToken,
  })
  if (error) return { data: [], error: new Error(error.message) }
  return { data: (data ?? []) as ChildAllowedVideo[], error: null }
}

export async function getChildAllowedChannels(accessToken: string): Promise<{
  data: ChildAllowedChannel[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_allowed_channels', {
    p_access_token: accessToken,
  })
  if (error) return { data: [], error: new Error(error.message) }
  return { data: (data ?? []) as ChildAllowedChannel[], error: null }
}

export async function getChildCachedChannelVideos(accessToken: string, youtubeChannelId: string): Promise<{
  data: ChildCachedChannelVideo[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_cached_channel_videos', {
    p_access_token: accessToken,
    p_youtube_channel_id: youtubeChannelId,
  })
  if (error) return { data: [], error: new Error(error.message) }
  return { data: (data ?? []) as ChildCachedChannelVideo[], error: null }
}

export async function childHeartbeat(accessToken: string) {
  return supabase.rpc('child_heartbeat', { p_access_token: accessToken })
}

export async function childMarkOffline(accessToken: string) {
  return supabase.rpc('child_mark_offline', { p_access_token: accessToken })
}
