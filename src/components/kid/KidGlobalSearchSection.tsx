import { memo } from 'react'
import type { YouTubeVideoResult } from '../../types'
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
  return (
    <div className={className}>
      <KidGlobalSearchBar
        id={id}
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSubmit}
      />
      {query || loading ? (
        <section
          className={`rounded-xl border border-yt-border bg-yt-surface/80 ${compact ? 'mt-2 p-2' : 'mt-3 p-3'}`}
          aria-live="polite"
          aria-label="תוצאות חיפוש YouTube"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className={`font-bold text-yt-text ${compact ? 'text-[11px]' : 'text-xs sm:text-sm'}`}>
              {query ? `"${query}"` : '…'}
            </p>
            <Button
              type="button"
              variant="secondary"
              className={compact ? '!min-h-7 !px-2 !py-0.5 text-[10px]' : '!min-h-8 !px-2 !py-1 text-xs'}
              onClick={onClear}
            >
              סגור
            </Button>
          </div>
          {loading ? (
            <div
              className={`flex items-center justify-center gap-2 text-yt-textMuted ${compact ? 'py-3 text-xs' : 'py-4 text-sm'}`}
            >
              <LoadingSpinner
                className={`border-2 border-yt-textMuted border-t-transparent ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`}
              />
              מחפש ב-YouTube…
            </div>
          ) : error ? (
            <p className={`text-yt-red ${compact ? 'text-xs' : 'text-sm'}`}>{error}</p>
          ) : results.length === 0 ? (
            <p className={`text-yt-textMuted ${compact ? 'text-xs' : 'text-sm'}`}>לא נמצאו סרטונים.</p>
          ) : (
            <>
              <div className={`space-y-2 overflow-y-auto ${compact ? 'max-h-48' : 'max-h-72'}`}>
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
                <div className={`flex justify-center ${compact ? 'mt-2' : 'mt-3'}`}>
                  <Button
                    type="button"
                    variant="secondary"
                    className={
                      compact
                        ? '!min-h-8 w-full !px-3 text-[11px]'
                        : '!min-h-10 w-full !px-4 text-sm'
                    }
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
                      'טען סרטונים נוספים'
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
})
