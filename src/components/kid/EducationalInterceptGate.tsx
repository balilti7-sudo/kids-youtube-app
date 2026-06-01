import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { InterceptPendingVideo, InterceptSettings } from '../../lib/educationalIntercept'
import { tryBeginPlayback } from '../../lib/educationalIntercept'

type GateContextValue = {
  onPlaybackActiveChange: (playing: boolean) => void
  watchSeconds: number
  /** Always false while runtime breaks are disabled */
  isInterceptActive: boolean
  onVideoPlaybackStarted: (videoId: string) => void
}

const GateContext = createContext<GateContextValue | null>(null)

const STABLE_GATE_VALUE: GateContextValue = {
  onPlaybackActiveChange: () => {},
  watchSeconds: 0,
  isInterceptActive: false,
  onVideoPlaybackStarted: () => {},
}

type Props = {
  settings: InterceptSettings
  deviceId: string | null
  children: ReactNode
  onResumePlayback?: (pending: InterceptPendingVideo | null) => void
}

/**
 * Pass-through wrapper — educational break overlay and watch timer are disabled
 * until the time-based system is re-enabled (see EDUCATIONAL_BREAKS_RUNTIME_ENABLED).
 */
export function EducationalInterceptGate({ children }: Props) {
  const ctx = useMemo(() => STABLE_GATE_VALUE, [])

  return <GateContext.Provider value={ctx}>{children}</GateContext.Provider>
}

export function useEducationalInterceptGate() {
  return useContext(GateContext)
}

/** Client-side playback gate — currently always allows playback. */
export function clientTryBeginPlayback(
  deviceId: string | null,
  pending: InterceptPendingVideo,
  settings: InterceptSettings
): boolean {
  if (!deviceId) return true
  return tryBeginPlayback(deviceId, pending, settings)
}
