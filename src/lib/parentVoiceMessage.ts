import { getSavedChildAccessToken } from './childDevice'
import { supabase } from './supabase'

export const PARENT_MESSAGES_BUCKET = 'parent_messages'
export const PARENT_VOICE_STORAGE_PATH = 'latest.webm'
export const PARENT_VOICE_REALTIME_CHANNEL_PREFIX = 'parent-voice'

export type ParentVoiceMessageState = {
  ownerUserId: string
  messageUrl: string
  messageAt: string
}

export type ParentVoiceBroadcastPayload = {
  messageUrl: string
  messageAt: string
}

function parseChildVoiceRow(row: Record<string, unknown>): ParentVoiceMessageState | null {
  const ownerUserId = String(row.owner_user_id ?? '').trim()
  const messageUrl = String(row.latest_parent_message ?? '').trim()
  const messageAtRaw = row.latest_parent_message_at
  const messageAt = messageAtRaw != null ? String(messageAtRaw) : ''
  if (!ownerUserId || !messageUrl || !messageAt) return null
  return { ownerUserId, messageUrl, messageAt }
}

export function parseChildVoiceOwnerRow(row: Record<string, unknown>): {
  ownerUserId: string
  message: ParentVoiceMessageState | null
} | null {
  const ownerUserId = String(row.owner_user_id ?? '').trim()
  if (!ownerUserId) return null
  const messageUrl = String(row.latest_parent_message ?? '').trim()
  const messageAtRaw = row.latest_parent_message_at
  const messageAt = messageAtRaw != null ? String(messageAtRaw) : ''
  const message =
    messageUrl && messageAt ? { ownerUserId, messageUrl, messageAt } : null
  return { ownerUserId, message }
}

export function parentVoiceStoragePath(userId: string): string {
  return `${userId.trim()}/${PARENT_VOICE_STORAGE_PATH}`
}

export function parentVoiceRealtimeChannel(ownerUserId: string): string {
  return `${PARENT_VOICE_REALTIME_CHANNEL_PREFIX}:${ownerUserId.trim()}`
}

export async function fetchLatestParentVoiceMessageForChild(): Promise<{
  data: ParentVoiceMessageState | null
  ownerUserId: string | null
  error: Error | null
}> {
  const token = getSavedChildAccessToken()?.trim()
  if (!token) return { data: null, ownerUserId: null, error: null }

  const { data, error } = await supabase.rpc('child_get_latest_parent_message', {
    p_access_token: token,
  })
  if (error) return { data: null, ownerUserId: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, ownerUserId: null, error: null }
  const parsed = parseChildVoiceOwnerRow(row as Record<string, unknown>)
  if (!parsed) return { data: null, ownerUserId: null, error: null }
  return { data: parsed.message, ownerUserId: parsed.ownerUserId, error: null }
}

export async function fetchLatestParentVoiceMessageForOwner(userId: string): Promise<{
  data: ParentVoiceMessageState | null
  error: Error | null
}> {
  const trimmed = userId.trim()
  if (!trimmed) return { data: null, error: new Error('USER_ID_REQUIRED') }

  const { data, error } = await supabase
    .from('parent_settings')
    .select('user_id, latest_parent_message, latest_parent_message_at')
    .eq('user_id', trimmed)
    .maybeSingle()

  if (error) return { data: null, error: new Error(error.message) }
  if (!data) return { data: null, error: null }

  return {
    data: parseChildVoiceRow({
      owner_user_id: data.user_id,
      latest_parent_message: data.latest_parent_message,
      latest_parent_message_at: data.latest_parent_message_at,
    }),
    error: null,
  }
}

export async function uploadParentVoiceMessage(
  userId: string,
  blob: Blob
): Promise<{ data: ParentVoiceMessageState | null; error: Error | null }> {
  const trimmed = userId.trim()
  if (!trimmed) return { data: null, error: new Error('USER_ID_REQUIRED') }
  if (!blob.size) return { data: null, error: new Error('EMPTY_RECORDING') }

  const path = parentVoiceStoragePath(trimmed)
  const contentType = blob.type || 'audio/webm'

  const { error: uploadError } = await supabase.storage
    .from(PARENT_MESSAGES_BUCKET)
    .upload(path, blob, { upsert: true, contentType })

  if (uploadError) return { data: null, error: new Error(uploadError.message) }

  const { data: publicUrlData } = supabase.storage.from(PARENT_MESSAGES_BUCKET).getPublicUrl(path)
  const messageUrl = publicUrlData.publicUrl?.trim()
  if (!messageUrl) return { data: null, error: new Error('PUBLIC_URL_FAILED') }

  const messageAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('parent_settings')
    .update({
      latest_parent_message: messageUrl,
      latest_parent_message_at: messageAt,
    })
    .eq('user_id', trimmed)

  if (updateError) return { data: null, error: new Error(updateError.message) }

  const state: ParentVoiceMessageState = {
    ownerUserId: trimmed,
    messageUrl,
    messageAt,
  }

  await broadcastParentVoiceMessage(state)

  return { data: state, error: null }
}

export async function broadcastParentVoiceMessage(state: ParentVoiceMessageState): Promise<void> {
  const channel = supabase.channel(parentVoiceRealtimeChannel(state.ownerUserId), {
    config: { broadcast: { self: false } },
  })

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      void supabase.removeChannel(channel)
      resolve()
    }, 4000)

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return
      window.clearTimeout(timeout)
      await channel.send({
        type: 'broadcast',
        event: 'voice_message',
        payload: {
          messageUrl: state.messageUrl,
          messageAt: state.messageAt,
        } satisfies ParentVoiceBroadcastPayload,
      })
      void supabase.removeChannel(channel)
      resolve()
    })
  })
}

const SEEN_STORAGE_PREFIX = 'safetube_parent_voice_seen_v1'

export function parentVoiceSeenStorageKey(deviceId: string): string {
  return `${SEEN_STORAGE_PREFIX}:${deviceId.trim()}`
}

export function readParentVoiceSeenAt(deviceId: string): string | null {
  try {
    const raw = sessionStorage.getItem(parentVoiceSeenStorageKey(deviceId))
    return raw?.trim() || null
  } catch {
    return null
  }
}

export function markParentVoiceSeen(deviceId: string, messageAt: string): void {
  try {
    sessionStorage.setItem(parentVoiceSeenStorageKey(deviceId), messageAt)
  } catch {
    /* ignore */
  }
}

export function isNewParentVoiceMessage(
  message: ParentVoiceMessageState,
  seenAt: string | null
): boolean {
  if (!seenAt) return true
  const seenMs = Date.parse(seenAt)
  const messageMs = Date.parse(message.messageAt)
  if (Number.isFinite(seenMs) && Number.isFinite(messageMs)) {
    return messageMs > seenMs
  }
  return message.messageAt !== seenAt
}
