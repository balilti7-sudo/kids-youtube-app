import { supabase } from './supabase'

export type DeviceSettingsUpdate = {
  allowShorts?: boolean | null
}

export type DeviceSettingsRow = {
  deviceId: string
  allowShorts: boolean
}

function mapDeviceSettingsRow(row: Record<string, unknown>): DeviceSettingsRow {
  return {
    deviceId: String(row.id ?? row.device_id ?? row.deviceId ?? ''),
    allowShorts: Boolean(row.allow_shorts ?? row.allowShorts),
  }
}

export function buildParentUpdateDeviceSettingsRpcArgs(
  deviceId: string,
  updates: DeviceSettingsUpdate
): {
  p_device_id: string
  p_allow_shorts: boolean | null
} {
  return {
    p_device_id: deviceId,
    p_allow_shorts: typeof updates.allowShorts === 'boolean' ? updates.allowShorts : null,
  }
}

/** Authenticated parent: update per-device settings (Shorts, etc.). */
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
