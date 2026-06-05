import { useCallback } from 'react'
import { useAuth } from './useAuth'
import { useLocalParentManagement } from './useLocalParentManagement'
import { readLocalParentSession } from '../lib/localParentAdmin'
import { verifyParentManagementPin } from '../lib/verifyParentManagementPin'
import type { ParentPinVerifyResult } from '../lib/verifyParentProfilePin'

/** Shared parent PIN verification for kid overlays (bedtime, daily limit, etc.). */
export function useParentManagementPinVerify(): (pin: string) => Promise<ParentPinVerifyResult> {
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const localPin = readLocalParentSession()?.pin?.trim() ?? ''

  return useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin ?? localPin },
        },
        pin
      ),
    [user?.id, profile, localParent.isActive, localParent.pin, localPin]
  )
}
