import { useMemo } from 'react'
import { useAuth } from './useAuth'
import { USE_DEV_DUMMY_DEVICE_OWNER } from '../config/dev'
import { resolveDeviceOwnerUserId } from '../lib/devDeviceOwner'
import { useLocalParentManagement } from './useLocalParentManagement'

/**
 * מזהה לשיוך מכשירים: auth/profile אמיתי, סשן הורה מקומי (מצומד), או מזהה דמה בפיתוח.
 */
export function useDeviceOwnerId() {
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const realId = profile?.id ?? user?.id ?? undefined
  const fixedDevOwnerId = import.meta.env.VITE_DEV_DEVICE_OWNER_ID?.trim()
  const hasFixedDevOwnerId = Boolean(fixedDevOwnerId && /^[0-9a-f-]{36}$/i.test(fixedDevOwnerId))

  const ownerUserId = useMemo(() => {
    if (localParent.isActive && localParent.ownerUserId) {
      return localParent.ownerUserId
    }
    return resolveDeviceOwnerUserId(realId ?? null)
  }, [realId, localParent.isActive, localParent.ownerUserId])

  const isDevFallback =
    USE_DEV_DUMMY_DEVICE_OWNER && Boolean(ownerUserId) && !realId && !localParent.isActive && !hasFixedDevOwnerId

  return { ownerUserId, isDevFallback, realId }
}
