import { getSavedChildAccessToken } from './childDevice'
import { supabase } from './supabase'

export const DEVICE_LINK_CODE_TTL_MS = 5 * 60 * 1000

export type DeviceLinkCode = {
  code: string
  expiresAt: string
  deviceId: string
  deviceName: string
}

export type LinkedDeviceResult = {
  deviceId: string
  deviceName: string
}

function mapDeviceLinkCodeRow(row: Record<string, unknown>): DeviceLinkCode | null {
  const code = String(row.code ?? '').trim()
  const expiresAt = row.expires_at != null ? String(row.expires_at) : ''
  const deviceId = String(row.device_id ?? '').trim()
  const deviceName = String(row.device_name ?? '').trim()
  if (!/^\d{6}$/.test(code) || !expiresAt || !deviceId) return null
  return { code, expiresAt, deviceId, deviceName: deviceName || 'Child device' }
}

function mapLinkedDeviceRow(row: Record<string, unknown>): LinkedDeviceResult | null {
  const deviceId = String(row.device_id ?? '').trim()
  const deviceName = String(row.device_name ?? '').trim()
  if (!deviceId) return null
  return { deviceId, deviceName: deviceName || 'Child device' }
}

export function formatDeviceLinkCode(code: string): string {
  const digits = code.replace(/\D/g, '').slice(0, 6)
  if (digits.length <= 3) return digits
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

export function normalizeDeviceLinkCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

export async function childGenerateDeviceLinkCode(): Promise<{
  data: DeviceLinkCode | null
  error: Error | null
}> {
  const token = getSavedChildAccessToken()?.trim()
  if (!token) {
    return { data: null, error: new Error('CHILD_ACCESS_TOKEN_REQUIRED') }
  }

  const { data, error } = await supabase.rpc('child_generate_device_link_code', {
    p_access_token: token,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: new Error('PAIRING_CODE_GENERATION_FAILED') }
  return { data: mapDeviceLinkCodeRow(row as Record<string, unknown>), error: null }
}

export async function parentLinkDeviceByCode(codeRaw: string): Promise<{
  data: LinkedDeviceResult | null
  error: Error | null
}> {
  const code = normalizeDeviceLinkCodeInput(codeRaw)
  if (code.length !== 6) {
    return { data: null, error: new Error('INVALID_PAIRING_CODE') }
  }

  const { data, error } = await supabase.rpc('parent_link_device_by_code', { p_code: code })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: new Error('PAIRING_FAILED') }
  return { data: mapLinkedDeviceRow(row as Record<string, unknown>), error: null }
}

export function mapDeviceLinkErrorMessage(error: Error | null | undefined): string {
  const msg = error?.message ?? ''
  if (msg.includes('DEVICE_LIMIT_REACHED')) {
    return 'הגעתם למגבלת הפרופילים בתוכנית הנוכחית.'
  }
  if (msg.includes('PAIRING_CODE_INVALID_OR_EXPIRED') || msg.includes('INVALID_PAIRING_CODE')) {
    return 'קוד לא תקין או שפג תוקפו (5 דקות).'
  }
  if (msg.includes('AUTH_REQUIRED')) {
    return 'יש להתחבר כהורה לפני קישור מכשיר.'
  }
  return msg || 'קישור המכשיר נכשל.'
}
