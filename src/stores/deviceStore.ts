import { create } from 'zustand'
import type { PostgrestError } from '@supabase/supabase-js'
import type { Device } from '../types'
import { supabase } from '../lib/supabase'

function formatSupabaseError(error: PostgrestError): string {
  const parts = [error.message, error.details, error.hint].filter((p) => p && String(p).trim())
  return parts.length ? parts.join(' — ') : error.message || 'שגיאה לא ידועה'
}

interface DeviceState {
  devices: Device[]
  loading: boolean
  error: string | null
  fetchLocalParentDeviceFromToken: (accessToken: string) => Promise<void>
  fetchDevices: (userId: string) => Promise<void>
  toggleBlock: (deviceId: string, isBlocked: boolean) => Promise<{ error: Error | null }>
  addDevice: (payload: {
    userId: string
    name: string
    device_type: 'phone' | 'tablet'
    pairing_code: string | null
  }) => Promise<{ data: Device | null; error: Error | null }>
  removeDevice: (deviceId: string) => Promise<{ error: Error | null }>
  setDevices: (devices: Device[]) => void
  setFromRealtime: (device: Device) => void
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  loading: false,
  error: null,

  setDevices: (devices) => set({ devices }),

  fetchLocalParentDeviceFromToken: async (accessToken) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase.rpc('local_parent_device_summary', {
        p_access_token: accessToken,
      })
      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[deviceStore.fetchLocalParentDeviceFromToken]', error)
        set({ loading: false, error: msg, devices: [] })
        return
      }
      const row = Array.isArray(data) ? data[0] : null
      if (!row) {
        set({ loading: false, devices: [] })
        return
      }
      const d = row as Device
      const withCount: Device = {
        ...d,
        channel_count: typeof d.channel_count === 'number' ? d.channel_count : Number(d.channel_count ?? 0),
      }
      set({ devices: [withCount], loading: false })
    } catch (err) {
      console.error('[deviceStore.fetchLocalParentDeviceFromToken]', err)
      set({
        loading: false,
        error: 'לא ניתן לטעון את פרטי המכשיר.',
        devices: [],
      })
    }
  },

  fetchDevices: async (userId) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) {
        const msg = formatSupabaseError(error)
        console.error('[deviceStore.fetchDevices]', error)
        set({ loading: false, error: msg })
        return
      }
      const rows = (data ?? []) as Device[]
      const withCounts = await Promise.all(
        rows.map(async (d) => {
          const { count } = await supabase
            .from('device_whitelist')
            .select('*', { count: 'exact', head: true })
            .eq('device_id', d.id)
          return { ...d, channel_count: count ?? 0 }
        })
      )
      set({ devices: withCounts, loading: false })
    } catch (err) {
      console.error('[deviceStore.fetchDevices] Network/runtime failure:', err)
      set({
        loading: false,
        error: 'לא ניתן להתחבר ל-Supabase כרגע (Network error). בדוק חיבור אינטרנט, חוסם פרסומות, או Firewall.',
      })
    }
  },

  toggleBlock: async (deviceId, isBlocked) => {
    const { error } = await supabase.from('devices').update({ is_blocked: isBlocked }).eq('id', deviceId)
    if (error) {
      console.error('[deviceStore.toggleBlock]', error)
      return { error: new Error(formatSupabaseError(error)) }
    }
    set({
      devices: get().devices.map((d) => (d.id === deviceId ? { ...d, is_blocked: isBlocked } : d)),
    })
    return { error: null }
  },

  addDevice: async ({ userId, name, device_type, pairing_code }) => {
    const row = { user_id: userId, name, device_type, pairing_code }
    const { data, error } = await supabase.from('devices').insert(row).select().single()
    if (error) {
      console.error('Connection Error:', error)
      return { data: null, error: new Error(formatSupabaseError(error)) }
    }
    const device = { ...(data as Device), channel_count: 0 }
    set({ devices: [device, ...get().devices] })
    return { data: device, error: null }
  },

  removeDevice: async (deviceId) => {
    const { error } = await supabase.from('devices').delete().eq('id', deviceId)
    if (error) {
      console.error('[deviceStore.removeDevice]', error)
      return { error: new Error(formatSupabaseError(error)) }
    }
    set({ devices: get().devices.filter((d) => d.id !== deviceId) })
    return { error: null }
  },

  setFromRealtime: (device) => {
    const list = get().devices
    const idx = list.findIndex((d) => d.id === device.id)
    if (idx === -1) {
      set({ devices: [{ ...device, channel_count: device.channel_count ?? 0 }, ...list] })
      return
    }
    const next = [...list]
    next[idx] = { ...next[idx], ...device }
    set({ devices: next })
  },
}))
