import { supabase } from './supabase'
import { clearLocalParentSession } from './localParentAdmin'
import { clearAppMode } from './appMode'

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
  try {
    window.dispatchEvent(new CustomEvent('safetube-kid-token-changed'))
  } catch {
    /* ignore */
  }
}

export function clearChildAccessToken() {
  localStorage.removeItem(CHILD_ACCESS_TOKEN_KEY)
  clearLocalParentSession()
  clearAppMode()
  try {
    window.dispatchEvent(new CustomEvent('safetube-kid-token-changed'))
  } catch {
    /* ignore */
  }
}

export async function pairChildDevice(pairingCode: string): Promise<{
  accessToken: string | null
  deviceName: string | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_pair_device', {
    p_pairing_code: pairingCode.trim(),
  })

  if (error) {
    const e = error as { message?: string; details?: string; hint?: string }
    const raw = [e.message, e.details, e.hint].filter(Boolean).join(' ')
    if (raw.includes('PAIRING_CODE_ALREADY_USED')) {
      return {
        accessToken: null,
        deviceName: null,
        error: new Error(
          'המכשיר כבר מחובר אצל ההורה עם הקוד הזה — החיבור כבר בוצע והקוד אינו פעיל יותר. אין צורך לחבר שוב. אם מדובר בטאבלט אחר או בתיקון, בקשו מההורה קוד חדש ממסך המכשירים.'
        ),
      }
    }
    return { accessToken: null, deviceName: null, error: new Error(error.message) }
  }
  const row = Array.isArray(data) ? data[0] : null
  if (!row?.access_token) {
    return {
      accessToken: null,
      deviceName: null,
      error: new Error(
        'לא מצאנו את הקוד. בדקו שההקלדה נכונה, או בקשו מההורה קוד עדכני מהמסך של המכשירים.'
      ),
    }
  }
  return { accessToken: String(row.access_token), deviceName: String(row.device_name ?? ''), error: null }
}

export async function getChildDeviceState(accessToken: string): Promise<{ data: ChildDeviceState | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_get_device_state', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  const r = row as Record<string, unknown>
  const rawId = r.device_id ?? r.id
  const deviceId = rawId != null && String(rawId).trim() ? String(rawId).trim() : ''
  const rawName = r.device_name ?? r.name
  const deviceName = rawName != null ? String(rawName) : ''
  return {
    data: {
      device_id: deviceId,
      device_name: deviceName,
      is_blocked: Boolean(r.is_blocked),
      is_online: Boolean(r.is_online),
      last_seen_at: r.last_seen_at != null ? String(r.last_seen_at) : null,
    },
    error: null,
  }
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

/** שורות מ־PostgREST לעיתים מגיעות עם שמות שדות שונים — מנרמלים לפני התצוגה */
function mapChildAllowedChannelRow(row: Record<string, unknown>): ChildAllowedChannel | null {
  const channelId = row.channel_id ?? row.channelId
  const ytId = row.youtube_channel_id ?? row.youtubeChannelId
  const name = row.channel_name ?? row.channelName
  if (typeof channelId !== 'string' || typeof ytId !== 'string' || typeof name !== 'string') return null
  return {
    channel_id: channelId,
    youtube_channel_id: ytId,
    channel_name: name,
    category: row.category != null && row.category !== '' ? String(row.category) : null,
    channel_thumbnail: row.channel_thumbnail != null ? String(row.channel_thumbnail) : null,
    subscriber_count: row.subscriber_count != null ? String(row.subscriber_count) : null,
  }
}

export async function getChildAllowedChannels(accessToken: string): Promise<{
  data: ChildAllowedChannel[]
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_allowed_channels', {
    p_access_token: accessToken,
  })
  if (error) return { data: [], error: new Error(error.message) }
  const raw = (data ?? []) as Record<string, unknown>[]
  const mapped = raw.map(mapChildAllowedChannelRow).filter((c): c is ChildAllowedChannel => c !== null)
  return { data: mapped, error: null }
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
