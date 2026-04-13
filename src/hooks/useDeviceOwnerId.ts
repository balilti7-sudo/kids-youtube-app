import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { USE_DEV_DUMMY_DEVICE_OWNER } from '../config/dev'
import { resolveDeviceOwnerUserId } from '../lib/devDeviceOwner'

/**
 * מזהה לשיוך מכשירים: auth/profile אמיתי, או מזהה דמה בפיתוח.
 */
export function useDeviceOwnerId() {
  const { user, profile } = useAuth()
  const realId = profile?.id ?? user?.id ?? undefined

  const ownerUserId = useMemo(
    () => resolveDeviceOwnerUserId(realId ?? null),
    [realId]
  )

  const isDevFallback =
    USE_DEV_DUMMY_DEVICE_OWNER && Boolean(ownerUserId) && !realId

  return { ownerUserId, isDevFallback, realId }
}
