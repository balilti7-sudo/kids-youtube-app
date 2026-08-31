import { useCallback, useEffect, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import {
  dismissSoftUpdate,
  isSoftUpdateDismissed,
  resolveAppUpdateGate,
  resolveUpdatePlatform,
  type AppUpdateGateState,
} from '../lib/appUpdatePolicy'

type VisibleGate =
  | { kind: 'none' }
  | { kind: 'soft' | 'hard'; state: Extract<AppUpdateGateState, { status: 'soft' | 'hard' }> }

/**
 * Launch + resume version gate. Soft prompts can be skipped until grace ends;
 * hard lock always surfaces.
 */
export function useAppUpdateGate() {
  const [visible, setVisible] = useState<VisibleGate>({ kind: 'none' })
  const [checking, setChecking] = useState(true)

  const refresh = useCallback(async () => {
    setChecking(true)
    try {
      const gate = await resolveAppUpdateGate()
      if (gate.status === 'hard') {
        setVisible({ kind: 'hard', state: gate })
        return
      }
      if (gate.status === 'soft') {
        const platform = resolveUpdatePlatform()
        if (isSoftUpdateDismissed(platform, gate.policy.latestVersion)) {
          setVisible({ kind: 'none' })
          return
        }
        setVisible({ kind: 'soft', state: gate })
        return
      }
      setVisible({ kind: 'none' })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => Promise<void> } | null = null
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh()
    }).then((h) => {
      handle = h
    })
    return () => {
      void handle?.remove()
    }
  }, [refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const skipSoftUpdate = useCallback(() => {
    setVisible((prev) => {
      if (prev.kind !== 'soft') return prev
      dismissSoftUpdate(resolveUpdatePlatform(), prev.state.policy.latestVersion)
      return { kind: 'none' }
    })
  }, [])

  return {
    checking,
    visible,
    refresh,
    skipSoftUpdate,
    /** True when playback / kid core UI must stay blocked. */
    hardLocked: visible.kind === 'hard',
  }
}
