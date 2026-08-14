import { useEffect, useRef } from 'react'

/**
 * Fires `onLoadMore` when `sentinelRef` enters the viewport (infinite scroll).
 * Disabled while `loading` or when `hasMore` is false.
 */
export function useNearBottomLoadMore(options: {
  enabled: boolean
  loading?: boolean
  rootMargin?: string
  onLoadMore: () => void
}) {
  const { enabled, loading = false, rootMargin = '480px 0px', onLoadMore } = options
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore

  useEffect(() => {
    if (!enabled || loading) return
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return

    let armed = true
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting)
        if (!hit || !armed) return
        armed = false
        onLoadMoreRef.current()
        // Re-arm shortly so the next page can trigger after DOM grows.
        window.setTimeout(() => {
          armed = true
        }, 800)
      },
      { root: null, rootMargin, threshold: 0 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, loading, rootMargin])

  return sentinelRef
}
