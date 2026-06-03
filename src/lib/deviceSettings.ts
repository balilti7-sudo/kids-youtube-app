import { supabase } from './supabase'
import type { EducationalBreakIntervalMinutes } from '../types'

export type DeviceSettingsUpdate = {
  allowShorts?: boolean | null
  breakIntervalMinutes?: EducationalBreakIntervalMinutes | null
  educationalInterceptEnabled?: boolean | null
}

export type DeviceSettingsRow = {
  deviceId: string
  allowShorts: boolean
  breakIntervalMinutes: EducationalBreakIntervalMinutes
  educationalInterceptEnabled: boolean
}

function mapDeviceSettingsRow(row: Record<string, unknown>): DeviceSettingsRow {
  return {
    deviceId: String(row.id ?? row.device_id ?? row.deviceId ?? ''),
    allowShorts: Boolean(row.allow_shorts ?? row.allowShorts),
    breakIntervalMinutes: Number(row.break_interval_minutes ?? row.breakIntervalMinutes ?? 15) as EducationalBreakIntervalMinutes,
    educationalInterceptEnabled: Boolean(
      row.educational_intercept_enabled ?? row.educationalInterceptEnabled
    ),
  }
}

/** Build RPC args with explicit nulls so PostgREST always targets the single 4-arg function. */
export function buildParentUpdateDeviceSettingsRpcArgs(
  deviceId: string,
  updates: DeviceSettingsUpdate
): {
  p_device_id: string
  p_allow_shorts: boolean | null
  p_break_interval_minutes: number | null
  p_educational_intercept_enabled: boolean | null
} {
  return {
    p_device_id: deviceId,
    p_allow_shorts: typeof updates.allowShorts === 'boolean' ? updates.allowShorts : null,
    p_break_interval_minutes:
      typeof updates.breakIntervalMinutes === 'number' ? updates.breakIntervalMinutes : null,
    p_educational_intercept_enabled:
      typeof updates.educationalInterceptEnabled === 'boolean'
        ? updates.educationalInterceptEnabled
        : null,
  }
}

/** Authenticated parent: update per-device settings (Shorts, breaks, etc.). */
export async function parentUpdateDeviceSettings(
  deviceId: string,
  updates: DeviceSettingsUpdate
): Promise<{ data: DeviceSettingsRow | null; error: Error | null }> {
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
