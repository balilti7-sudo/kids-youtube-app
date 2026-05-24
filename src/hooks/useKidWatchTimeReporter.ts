import { useEffect, useRef } from 'react'
import { isMediaPlaybackActive } from '../lib/mediaPlaybackActivity'
import { reportChildWatchSeconds } from '../lib/childDevice'

const REPORT_INTERVAL_MS = 30_000
const TICK_MS = 1_000

/**
 * Accumulates watch seconds while video plays and syncs batches to Supabase.
 * Skips reporting when the screen is locked by parental controls.
 */
export function useKidWatchTimeReporter(
  accessToken: string | null,
  screenLocked: boolean,
  onWatchSecondsToday?: (seconds: number) => void,
  onLocalSecond?: () => void
) {
  const pendingRef = useRef(0)

  useEffect(() => {
    if (!accessToken || screenLocked) return

    const tickId = window.setInterval(() => {
      if (screenLocked || !isMediaPlaybackActive()) return
      pendingRef.current += 1
      onLocalSecond?.()
    }, TICK_MS)

    const reportId = window.setInterval(() => {
      if (screenLocked || !accessToken) return
      const batch = pendingRef.current
      if (batch <= 0) return
      pendingRef.current = 0
      void reportChildWatchSeconds(accessToken, batch).then(({ watchSecondsToday }) => {
        if (watchSecondsToday != null) onWatchSecondsToday?.(watchSecondsToday)
      })
    }, REPORT_INTERVAL_MS)

    return () => {
      window.clearInterval(tickId)
      window.clearInterval(reportId)
      const leftover = pendingRef.current
      pendingRef.current = 0
      if (leftover > 0 && accessToken && !screenLocked) {
        void reportChildWatchSeconds(accessToken, leftover).then(({ watchSecondsToday }) => {
          if (watchSecondsToday != null) onWatchSecondsToday?.(watchSecondsToday)
        })
      }
    }
  }, [accessToken, screenLocked, onWatchSecondsToday, onLocalSecond])
}
