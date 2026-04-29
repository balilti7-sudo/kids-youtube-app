import { useEffect, useMemo, useState } from 'react'
import {
  isLocalParentSessionValid,
  readLocalParentSession,
} from '../lib/localParentAdmin'

/** מצב ניהול מקומי (מצומד + סשן PIN) — מתעדכן כשפג תוקף או כשמנקים טוקן */
export function useLocalParentManagement() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onKidToken = () => setTick((t) => t + 1)
    window.addEventListener('safetube-kid-token-changed', onKidToken)
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000)
    return () => {
      window.removeEventListener('safetube-kid-token-changed', onKidToken)
      window.clearInterval(id)
    }
  }, [])

  const snapshot = useMemo(() => {
    if (!isLocalParentSessionValid()) {
      return { isActive: false as const, localAccessToken: null as string | null, deviceId: null as string | null, ownerUserId: null as string | null, pin: null as string | null }
    }
    const s = readLocalParentSession()
    if (!s) {
      return { isActive: false as const, localAccessToken: null as string | null, deviceId: null as string | null, ownerUserId: null as string | null, pin: null as string | null }
    }
    return {
      isActive: true as const,
      localAccessToken: s.accessToken,
      deviceId: s.deviceId,
      ownerUserId: s.ownerUserId,
      pin: s.pin,
    }
  }, [tick])

  return snapshot
}
