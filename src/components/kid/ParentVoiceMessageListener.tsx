import { useAuth } from '../../hooks/useAuth'
import { useParentVoiceMessageListener } from '../../hooks/useParentVoiceMessageListener'
import { ParentVoiceMessageOverlay } from './ParentVoiceMessageOverlay'

type Props = {
  deviceId: string | null | undefined
  ownerUserId?: string | null | undefined
}

/** Subscribes to parent voice messages and shows a one-time overlay for the child. */
export function ParentVoiceMessageListener({ deviceId, ownerUserId }: Props) {
  const { user } = useAuth()
  const resolvedOwnerId = ownerUserId?.trim() || user?.id || null
  const ownerSession = Boolean(user?.id && resolvedOwnerId && user.id === resolvedOwnerId)

  const { activeMessage, dismissMessage } = useParentVoiceMessageListener({
    deviceId,
    ownerUserId: resolvedOwnerId,
    ownerSession,
  })

  if (!activeMessage) return null

  return <ParentVoiceMessageOverlay message={activeMessage} onDismiss={dismissMessage} />
}
