import { isLocalParentSessionValid, readLocalParentSession } from './localParentAdmin'
import { supabase } from './supabase'

export type DeviceSettingsUpdate = {
  allowShorts?: boolean | null
  blockYoutubeApp?: boolean | null
  browserFilterEnabled?: boolean | null
  browserWhitelist?: string[] | null
  /** 0 = unlimited; 1–1440 = minutes per day */
  dailyTimeLimitMinutes?: number | null
}

export type DeviceSettingsRow = {
  deviceId: string
  allowShorts: boolean
  blockYoutubeApp: boolean
  browserFilterEnabled: boolean
  browserWhitelist: string[]
  dailyTimeLimitMinutes: number
}

function mapWhitelist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((h) => String(h ?? '').trim()).filter(Boolean)
}

function mapDailyLimit(raw: unknown): number {
  const n = Number(raw ?? 60)
  if (!Number.isFinite(n)) return 60
  const rounded = Math.round(n)
  if (rounded === 0) return 0
  if (rounded < 1) return 60
  return Math.min(1440, rounded)
}

function mapDeviceSettingsRow(row: Record<string, unknown>): DeviceSettingsRow {
  return {
    deviceId: String(row.id ?? row.device_id ?? row.deviceId ?? ''),
    allowShorts: Boolean(row.allow_shorts ?? row.allowShorts),
    blockYoutubeApp: Boolean(row.block_youtube_app ?? row.blockYoutubeApp),
    browserFilterEnabled: Boolean(row.browser_filter_enabled ?? row.browserFilterEnabled),
    browserWhitelist: mapWhitelist(row.browser_whitelist ?? row.browserWhitelist),
    dailyTimeLimitMinutes: mapDailyLimit(row.daily_time_limit_minutes ?? row.dailyTimeLimitMinutes),
  }
}

export function buildParentUpdateDeviceSettingsRpcArgs(
  deviceId: string,
  updates: DeviceSettingsUpdate
): {
  p_device_id: string
  p_allow_shorts: boolean | null
  p_block_youtube_app: boolean | null
  p_browser_filter_enabled: boolean | null
  p_browser_whitelist: string[] | null
  p_daily_time_limit_minutes: number | null
} {
  return {
    p_device_id: deviceId,
    p_allow_shorts: typeof updates.allowShorts === 'boolean' ? updates.allowShorts : null,
    p_block_youtube_app: typeof updates.blockYoutubeApp === 'boolean' ? updates.blockYoutubeApp : null,
    p_browser_filter_enabled:
      typeof updates.browserFilterEnabled === 'boolean' ? updates.browserFilterEnabled : null,
    p_browser_whitelist: Array.isArray(updates.browserWhitelist) ? updates.browserWhitelist : null,
    p_daily_time_limit_minutes:
      typeof updates.dailyTimeLimitMinutes === 'number' && Number.isFinite(updates.dailyTimeLimitMinutes)
        ? Math.round(updates.dailyTimeLimitMinutes)
        : null,
  }
}

/** Authenticated parent OR local-parent PIN session: update per-device settings. */
export async function parentUpdateDeviceSettings(
  deviceId: string,
  updates: DeviceSettingsUpdate
): Promise<{ data: DeviceSettingsRow | null; error: Error | null }> {
  const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null
  if (localSession?.accessToken) {
    const { data, error } = await supabase.rpc('local_parent_update_device_settings', {
      p_access_token: localSession.accessToken,
      p_allow_shorts: typeof updates.allowShorts === 'boolean' ? updates.allowShorts : null,
      p_block_youtube_app: typeof updates.blockYoutubeApp === 'boolean' ? updates.blockYoutubeApp : null,
      p_browser_filter_enabled:
        typeof updates.browserFilterEnabled === 'boolean' ? updates.browserFilterEnabled : null,
      p_browser_whitelist: Array.isArray(updates.browserWhitelist) ? updates.browserWhitelist : null,
      p_daily_time_limit_minutes:
        typeof updates.dailyTimeLimitMinutes === 'number' && Number.isFinite(updates.dailyTimeLimitMinutes)
          ? Math.round(updates.dailyTimeLimitMinutes)
          : null,
    })
    if (error) return { data: null, error: new Error(error.message) }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { data: null, error: null }
    }
    return { data: mapDeviceSettingsRow(data as Record<string, unknown>), error: null }
  }

  const { data, error } = await supabase.rpc(
    'parent_update_device_settings',
    buildParentUpdateDeviceSettingsRpcArgs(deviceId, updates)
  )
  if (error) return { data: null, error: new Error(error.message) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data: null, error: null }
  }
  return { data: mapDeviceSettingsRow(data as Record<string, unknown>), error: null }
}
