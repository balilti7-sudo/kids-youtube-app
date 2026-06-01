import type { InterceptPendingVideo, InterceptSettings } from '../lib/educationalIntercept'

type Options = {
  deviceId: string | null
  settings: InterceptSettings
  enabled: boolean
  playing: boolean
  pendingVideo: InterceptPendingVideo | null
  onThresholdReached: (pending: InterceptPendingVideo) => void
  syncWatchSeconds?: (deltaSeconds: number) => Promise<void>
}

/**
 * Disabled until EDUCATIONAL_BREAKS_RUNTIME_ENABLED is true.
 * (Previous setInterval + localStorage dispatch caused re-render loops.)
 */
export function useEducationalWatchTimer(_options: Options) {
  return { watchSeconds: 0, storageKey: null }
}
