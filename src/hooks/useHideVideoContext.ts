import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './useAuth'
import { useDeviceOwnerId } from './useDeviceOwnerId'
import { useDevices } from './useDevices'
import { useLocalParentManagement } from './useLocalParentManagement'
import { verifyParentManagementPin } from '../lib/verifyParentManagementPin'

/** Parent dashboard / channel manager — device + PIN context for hide & quick-block. */
export function useHideVideoContext() {
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const { devices } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)

  useEffect(() => {
    if (!deviceId && devices[0]?.id) setDeviceId(devices[0].id)
  }, [devices, deviceId])

  const verifyPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin },
        },
        pin
      ),
    [user?.id, profile, localParent.isActive, localParent.pin]
  )

  const canQuickBlock = useMemo(
    () => Boolean((localParent.isActive && localParent.localAccessToken) || (user?.id && deviceId)),
    [localParent.isActive, localParent.localAccessToken, user?.id, deviceId]
  )

  return {
    canQuickBlock,
    deviceId,
    localAccessToken: localParent.localAccessToken,
    cachedPin: localParent.isActive ? localParent.pin : null,
    verifyPin,
  }
}
