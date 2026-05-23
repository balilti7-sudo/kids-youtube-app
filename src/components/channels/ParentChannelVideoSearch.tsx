import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { YouTubeVideoResult } from '../../types'
import { RtlSearchInput } from '../search/RtlSearchInput'

export type ParentVideoSearchMode = 'channel' | 'youtube'

export type ParentChannelVideoSearchProps = {
  id?: string
  mode: ParentVideoSearchMode
  onModeChange: (mode: ParentVideoSearchMode) => void
  value: string
  onChange: (value: string) => void
  channelTotalCount: number
  channelFilteredCount: number
  channelLabel: string | null
  youtubeLoading?: boolean
  youtubeError?: string | null
  youtubeResults?: YouTubeVideoResult[]
  onYoutubeSearch: (query: string) => void
  youtubeResultsSlot?: (results: YouTubeVideoResult[]) => ReactNode
  className?: string
}

const MODE_TABS: { id: ParentVideoSearchMode; label: string }[] = [
  { id: 'channel', label: 'חפש בערוץ' },
  { id: 'youtube', label: 'חפש ב-YouTube' },
]

/**
 * Parent channel preview search — channel filter or global YouTube API search.
 */
export const ParentChannelVideoSearch = memo(function ParentChannelVideoSearch({
  id,
  mode,
  onModeChange,
  value,
  onChange,
  channelTotalCount,
  channelFilteredCount,
  channelLabel,
  youtubeLoading = false,
  youtubeError = null,
  youtubeResults = [],
  onYoutubeSearch,
  youtubeResultsSlot,
  className,
}: ParentChannelVideoSearchProps) {
  const [debouncedYoutubeQuery, setDebouncedYoutubeQuery] = useState('')

  useEffect(() => {
    if (mode !== 'youtube') return
    const trimmed = value.trim()
    if (!trimmed) {
      setDebouncedYoutubeQuery('')
      onYoutubeSearch('')
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedYoutubeQuery(trimmed)
      onYoutubeSearch(trimmed)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [mode, value, onYoutubeSearch])

  const handleModeChange = useCallback(
    (next: ParentVideoSearchMode) => {
      if (next === mode) return
      onChange('')
      onYoutubeSearch('')
      onModeChange(next)
    },
    [mode, onChange, onModeChange, onYoutubeSearch]
  )

  const trimmed = value.trim()
  const hasQuery = trimmed.length > 0
  const showingAllChannel =
    mode === 'channel' && (!hasQuery || channelFilteredCount === channelTotalCount)

  const placeholder =
    mode === 'channel' ? 'חפשו סרטון בערוץ…' : 'חפשו סרטון בכל YouTube…'

  return (
    <section className={cn('w-full', className)} aria-label="חיפוש סרטונים להורים">
      <div className="mb-2.5 text-right">
        <h3 className="text-base font-bold leading-tight text-slate-900 dark:text-zinc-100 sm:text-lg">
          חיפוש סרטונים
        </h3>
        <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-zinc-400 sm:text-sm">
          {mode === 'channel' ? (
            channelLabel ? (
              <>
                מצאו סרטון ב־<span className="text-slate-700 dark:text-zinc-200">{channelLabel}</span>
              </>
            ) : (
              'הקלידו שם סרטון — הרשימה מתעדכנת מיד'
            )
          ) : (
            'חפשו בכל YouTube והוסיפו לפלייליסט בלחיצה על ➕'
          )}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="סוג חיפוש"
        className="mb-2.5 flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/60"
      >
        {MODE_TABS.map((tab) => {
          const active = mode === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'min-h-[40px] flex-1 rounded-lg px-2 text-sm font-bold transition',
                active
                  ? 'bg-white text-brand-800 shadow-sm dark:bg-zinc-900 dark:text-brand-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              )}
              onClick={() => handleModeChange(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <RtlSearchInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={mode === 'channel' ? 'חיפוש לפי שם סרטון בערוץ' : 'חיפוש סרטונים ב-YouTube'}
        inputClassName="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {mode === 'channel' ? (
        <p className="mt-2 text-xs font-medium text-slate-500 dark:text-zinc-500 sm:text-sm" aria-live="polite">
          {channelTotalCount === 0
            ? 'אין עדיין סרטונים ברשימה'
            : showingAllChannel
              ? `${channelTotalCount} סרטונים בערוץ`
              : `מוצגים ${channelFilteredCount} מתוך ${channelTotalCount} סרטונים`}
        </p>
      ) : (
        <div className="mt-3 space-y-2" aria-live="polite">
          {!hasQuery ? (
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-500 sm:text-sm">
              הקלידו מילות חיפוש כדי לחפש בכל YouTube
            </p>
          ) : youtubeLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-slate-600 dark:text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              מחפש ב-YouTube…
            </div>
          ) : youtubeError ? (
            <p className="text-sm text-danger-600 dark:text-red-400">{youtubeError}</p>
          ) : debouncedYoutubeQuery && youtubeResults.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-zinc-400">
              לא נמצאו סרטונים עבור &quot;{debouncedYoutubeQuery}&quot;
            </p>
          ) : youtubeResults.length > 0 && youtubeResultsSlot ? (
            youtubeResultsSlot(youtubeResults)
          ) : null}
        </div>
      )}
    </section>
  )
})
