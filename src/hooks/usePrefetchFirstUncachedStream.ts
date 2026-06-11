import { useEffect, useRef } from 'react'
import { prefetchFirstUncachedStream } from '../lib/streamApi'

/**
 * Prefetch at most one stream — the first videoId in list order that is not yet warm.
 */
export function usePrefetchFirstUncachedStream(orderedVideoIds: readonly string[]): void {
  const idsKey = orderedVideoIds.map((id) => id.trim()).filter(Boolean).join('\0')
  const prevKeyRef = useRef('')

  useEffect(() => {
    if (!idsKey || idsKey === prevKeyRef.current) return
    prevKeyRef.current = idsKey
    prefetchFirstUncachedStream(orderedVideoIds)
  }, [idsKey, orderedVideoIds])
}
