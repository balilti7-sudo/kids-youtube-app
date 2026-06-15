import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { YouTubeVideoResult } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { KidGlobalSearchBar } from './KidGlobalSearchBar'

export type KidGlobalSearchSectionProps = {
  id: string
  inputValue: string
  onInputChange: (value: string) => void
  onSubmit: (query: string) => void
  query: string | null
  loading: boolean
  error: string | null
  results: YouTubeVideoResult[]
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onClear: () => void
  compact?: boolean
  className?: string
}

export const KidGlobalSearchSection = memo(function KidGlobalSearchSection({
  id,
  inputValue,
  onInputChange,
  onSubmit,
  query,
  loading,
  error,
  results,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onClear,
  compact = false,
  className,
}: KidGlobalSearchSectionProps) {
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  const showPanel = Boolean(query || loading || (focused && inputValue.trim()))

  const handleFocusChange = useCallback((next: boolean) => {
    setFocused(next)
  }, [])

  useEffect(() => {
    if (!focused) return
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current
      if (!root || root.contains(event.target as Node)) return
      setFocused(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [focused])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <KidGlobalSearchBar
        id={id}
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onFocusChange={handleFocusChange}
      />

      {showPanel ? (
        <section
          id={panelId}
          className={`rounded-xl border border-yt-border bg-yt-surface/80 ${compact ? 'mt-2' : 'mt-3'}`}
          aria-live="polite"
          aria-label="תוצאות חיפוש YouTube"
        >
          <div className={`flex items-center justify-between gap-2 border-b border-yt-border ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
            <p className={`min-w-0 truncate font-bold text-yt-text ${compact ? 'text-[11px]' : 'text-xs sm:text-sm'}`}>
              {query ? `"${query}"` : '…'}
            </p>
            <Button
              type="button"
              variant="secondary"
              className={compact ? '!min-h-7 !px-2 !py-0.5 text-[10px]' : '!min-h-8 !px-2 !py-1 text-xs'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClear}
            >
              סגור
            </Button>
          </div>

          <div className={`flex max-h-[min(55vh,320px)] flex-col ${compact ? 'p-2' : 'p-3'}`}>
            {loading ? (
              <div
                className={`flex flex-1 items-center justify-center gap-2 text-yt-textMuted ${compact ? 'py-3 text-xs' : 'py-4 text-sm'}`}
              >
                <LoadingSpinner
                  className={`border-2 border-yt-textMuted border-t-transparent ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
                />
                מחפש ב-YouTube…
              </div>
            ) : error ? (
              <p className={`py-2 text-yt-red ${compact ? 'text-xs' : 'text-sm'}`}>{error}</p>
            ) : results.length === 0 ? (
              <p className={`py-2 text-yt-textMuted ${compact ? 'text-xs' : 'text-sm'}`}>לא נמצאו סרטונים.</p>
            ) : (
              <>
                <div className={`min-h-0 flex-1 space-y-2 overflow-y-auto ${compact ? 'max-h-48' : 'max-h-72'}`}>
                  {results.map((video) => (
                    <div
                      key={video.videoId}
                      className={`flex gap-2 rounded-lg border border-yt-border bg-yt-input/40 ${compact ? 'p-1.5' : 'p-2'}`}
                    >
                      {video.thumbnail ? (
                        <img
                          src={video.thumbnail}
                          alt=""
                          className={`shrink-0 rounded-md object-cover ${compact ? 'h-10 w-16' : 'h-14 w-24'}`}
                          loading="lazy"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1 text-right">
                        <p
                          className={`line-clamp-2 font-semibold text-yt-text ${compact ? 'text-[10px]' : 'text-xs'}`}
                        >
                          {video.title}
                        </p>
                        <p className={`truncate text-yt-textMuted ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
                          {video.channelTitle || 'ערוץ לא ידוע'}
                        </p>
                        <p className={`mt-1 text-yt-textMuted ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
                          צפייה — רק דרך ערוצים מאושרים
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {hasMore && onLoadMore ? (
                  <div className={`shrink-0 border-t border-yt-border ${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'}`}>
                    <Button
                      type="button"
                      variant="secondary"
                      className={
                        compact
                          ? '!min-h-8 w-full !px-3 text-[11px]'
                          : '!min-h-10 w-full !px-4 text-sm'
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={onLoadMore}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                    >
                      {loadingMore ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <LoadingSpinner
                            className={`border-2 border-yt-textMuted border-t-transparent ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
                          />
                          טוען…
                        </span>
                      ) : (
                        'טען עוד'
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
})
