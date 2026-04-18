import { useEffect } from 'react'
import type { Device } from '../types'
import { supabase } from '../lib/supabase'
import { useDeviceStore } from '../stores/deviceStore'
import { useLocalParentManagement } from './useLocalParentManagement'

export function useDevices(userId: string | undefined) {
  const localParent = useLocalParentManagement()
  const devices = useDeviceStore((s) => s.devices)
  const loading = useDeviceStore((s) => s.loading)
  const error = useDeviceStore((s) => s.error)
  const fetchDevices = useDeviceStore((s) => s.fetchDevices)
  const fetchLocalParentDeviceFromToken = useDeviceStore((s) => s.fetchLocalParentDeviceFromToken)
  const setFromRealtime = useDeviceStore((s) => s.setFromRealtime)

  useEffect(() => {
    if (localParent.isActive && localParent.localAccessToken) {
      void fetchLocalParentDeviceFromToken(localParent.localAccessToken)
      return
    }
    if (!userId) return
    void fetchDevices(userId)
  }, [userId, localParent.isActive, localParent.localAccessToken, fetchDevices, fetchLocalParentDeviceFromToken])

  useEffect(() => {
    if (localParent.isActive) return
    if (!userId) return

    // שם ערוץ ייחודי לכל hook instance — אחרת שני קומפוננטות עם אותו userId
    // משתפות ערוץ Realtime אחד ומנסות להוסיף .on() אחרי subscribe() (שגיאת Supabase).
    const channelSuffix =
      typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `rt-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

    const channel = supabase
      .channel(`devices-${userId}-${channelSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'devices', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === 'DELETE' && payload.old?.id) {
            useDeviceStore.setState({
              devices: useDeviceStore.getState().devices.filter((d) => d.id !== payload.old.id),
            })
            return
          }
          const row = (payload.new ?? payload.old) as Device | undefined
          if (row?.id) setFromRealtime(row as Device)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, localParent.isActive, setFromRealtime])

  return {
    devices,
    loading,
    error,
    refetch: async () => {
      if (localParent.isActive && localParent.localAccessToken) {
        await fetchLocalParentDeviceFromToken(localParent.localAccessToken)
        return
      }
      if (userId) await fetchDevices(userId)
    },
  }
}
