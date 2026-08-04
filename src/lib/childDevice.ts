import type { WhitelistedChannel } from '../types'
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
  allow_shorts: boolean
  block_youtube_app: boolean
  browser_filter_enabled: boolean
  browser_whitelist: string[]
  daily_time_limit_minutes: number
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
  videos_cache_has_more?: boolean
  videos_cache_next_page_token?: string | null
  videos_cache_uploads_playlist_id?: string | null
}

export interface ChildCachedChannelVideo {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  published_at: string | null
  duration_seconds?: number | null
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
  const whitelistRaw = r.browser_whitelist ?? r.browserWhitelist
  const browser_whitelist = Array.isArray(whitelistRaw)
    ? whitelistRaw.map((h) => String(h ?? '').trim()).filter(Boolean)
    : []

  return {
    data: {
      device_id: deviceId,
      device_name: deviceName,
      is_blocked: Boolean(r.is_blocked),
      is_online: Boolean(r.is_online),
      last_seen_at: r.last_seen_at != null ? String(r.last_seen_at) : null,
      allow_shorts: Boolean(r.allow_shorts ?? r.allowShorts),
      block_youtube_app: Boolean(r.block_youtube_app ?? r.blockYoutubeApp),
      browser_filter_enabled: Boolean(r.browser_filter_enabled ?? r.browserFilterEnabled),
      browser_whitelist,
      daily_time_limit_minutes: (() => {
        const n = Number(r.daily_time_limit_minutes ?? r.dailyTimeLimitMinutes ?? 60)
        if (!Number.isFinite(n)) return 60
        const rounded = Math.round(n)
        if (rounded === 0) return 0
        if (rounded < 1) return 60
        return Math.min(1440, rounded)
      })(),
    },
    error: null,
  }
}

export function mapHeartbeatRow(row: Record<string, unknown>): Partial<ChildDeviceState> {
  return {
    is_blocked: Boolean(row.is_blocked),
    last_seen_at: row.last_seen_at != null ? String(row.last_seen_at) : null,
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
    videos_cache_has_more: Boolean(row.videos_cache_has_more),
    videos_cache_next_page_token:
      row.videos_cache_next_page_token != null ? String(row.videos_cache_next_page_token) : null,
    videos_cache_uploads_playlist_id:
      row.videos_cache_uploads_playlist_id != null ? String(row.videos_cache_uploads_playlist_id) : null,
  }
}

/** Maps child RPC rows to the shared whitelist shape used by the channels UI. */
export function childAllowedChannelToWhitelist(channel: ChildAllowedChannel): WhitelistedChannel {
  return {
    id: channel.channel_id,
    youtube_channel_id: channel.youtube_channel_id,
    channel_name: channel.channel_name,
    category: channel.category,
    channel_thumbnail: channel.channel_thumbnail,
    subscriber_count: channel.subscriber_count,
    description: null,
    videos_cache_has_more: channel.videos_cache_has_more ?? false,
    videos_cache_next_page_token: channel.videos_cache_next_page_token ?? null,
    videos_cache_uploads_playlist_id: channel.videos_cache_uploads_playlist_id ?? null,
    created_at: new Date(0).toISOString(),
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
  const { data, error } = await supabase.rpc('child_heartbeat', { p_access_token: accessToken })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapHeartbeatRow(row as Record<string, unknown>), error: null }
}

export async function childMarkOffline(accessToken: string) {
  return supabase.rpc('child_mark_offline', { p_access_token: accessToken })
}
