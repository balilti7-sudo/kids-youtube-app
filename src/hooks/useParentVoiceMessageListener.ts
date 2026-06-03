import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  fetchLatestParentVoiceMessageForChild,
  fetchLatestParentVoiceMessageForOwner,
  isNewParentVoiceMessage,
  markParentVoiceSeen,
  parentVoiceRealtimeChannel,
  readParentVoiceSeenAt,
  type ParentVoiceBroadcastPayload,
  type ParentVoiceMessageState,
} from '../lib/parentVoiceMessage'

type Options = {
  deviceId: string | null | undefined
  ownerUserId: string | null | undefined
  /** When true, read parent_settings directly + Realtime postgres_changes (logged-in parent). */
  ownerSession?: boolean
}

type Result = {
  activeMessage: ParentVoiceMessageState | null
  dismissMessage: () => void
}

export function useParentVoiceMessageListener({
  deviceId,
  ownerUserId,
  ownerSession = false,
}: Options): Result {
  const [activeMessage, setActiveMessage] = useState<ParentVoiceMessageState | null>(null)
  const seenAtRef = useRef<string | null>(null)

  const trimmedDeviceId = deviceId?.trim() || null
  const trimmedOwnerId = ownerUserId?.trim() || null

  useEffect(() => {
    seenAtRef.current = trimmedDeviceId ? readParentVoiceSeenAt(trimmedDeviceId) : null
  }, [trimmedDeviceId])

  const considerMessage = useCallback(
    (message: ParentVoiceMessageState | null) => {
      if (!message || !trimmedDeviceId) {
        setActiveMessage(null)
        return
      }
      const seenAt = seenAtRef.current ?? readParentVoiceSeenAt(trimmedDeviceId)
      seenAtRef.current = seenAt
      if (isNewParentVoiceMessage(message, seenAt)) {
        setActiveMessage(message)
        return
      }
      setActiveMessage(null)
    },
    [trimmedDeviceId]
  )

  const dismissMessage = useCallback(() => {
    if (!activeMessage || !trimmedDeviceId) {
      setActiveMessage(null)
      return
    }
    seenAtRef.current = activeMessage.messageAt
    markParentVoiceSeen(trimmedDeviceId, activeMessage.messageAt)
    setActiveMessage(null)
  }, [activeMessage, trimmedDeviceId])

  useEffect(() => {
    if (!trimmedDeviceId) {
      setActiveMessage(null)
      return
    }

    let cancelled = false
    let resolvedOwnerId = trimmedOwnerId

    const loadInitial = async () => {
      let message: ParentVoiceMessageState | null = null

      if (ownerSession && resolvedOwnerId) {
        const { data, error } = await fetchLatestParentVoiceMessageForOwner(resolvedOwnerId)
        if (cancelled) return
        if (error) {
          console.warn('[ParentVoiceMessage] initial load failed', error.message)
          return
        }
        message = data
      } else {
        const { data, ownerUserId, error } = await fetchLatestParentVoiceMessageForChild()
        if (cancelled) return
        if (error) {
          console.warn('[ParentVoiceMessage] initial load failed', error.message)
          return
        }
        if (!resolvedOwnerId && ownerUserId) {
          resolvedOwnerId = ownerUserId
        }
        message = data
      }

      if (!resolvedOwnerId) return
      considerMessage(message)
      if (cancelled) return
      subscribe(resolvedOwnerId)
    }

    const subscribe = (ownerId: string) => {
      const channel = supabase.channel(parentVoiceRealtimeChannel(ownerId), {
        config: { broadcast: { self: false } },
      })

      if (ownerSession) {
        channel.on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'parent_settings',
            filter: `user_id=eq.${ownerId}`,
          },
          (payload) => {
            const row = payload.new as Record<string, unknown> | null
            if (!row) return
            const messageUrl = String(row.latest_parent_message ?? '').trim()
            const messageAt = row.latest_parent_message_at != null ? String(row.latest_parent_message_at) : ''
            if (!messageUrl || !messageAt) return
            considerMessage({
              ownerUserId: ownerId,
              messageUrl,
              messageAt,
            })
          }
        )
      }

      channel.on('broadcast', { event: 'voice_message' }, ({ payload }) => {
        const p = payload as ParentVoiceBroadcastPayload | undefined
        if (!p?.messageUrl || !p.messageAt) return
        considerMessage({
          ownerUserId: ownerId,
          messageUrl: p.messageUrl,
          messageAt: p.messageAt,
        })
      })

      channel.subscribe()

      cleanupChannel = () => {
        void supabase.removeChannel(channel)
      }
    }

    let cleanupChannel: (() => void) | null = null

    void loadInitial()

    return () => {
      cancelled = true
      cleanupChannel?.()
    }
  }, [trimmedDeviceId, trimmedOwnerId, ownerSession, considerMessage])

  return { activeMessage, dismissMessage }
}
