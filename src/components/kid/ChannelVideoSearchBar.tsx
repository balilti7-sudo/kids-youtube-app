import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { RtlSearchInput } from '../search/RtlSearchInput'

export type ChannelVideoSearchDropdownItem = {
  id: string
  title: string
  thumbnail?: string | null
}

export type ChannelVideoSearchBarProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  totalCount: number
  filteredCount: number
  channelLabel?: string | null
  className?: string
  onFocusChange?: (focused: boolean) => void
  /** Instant results shown in a dropdown directly under the search input. */
  dropdownResults?: ChannelVideoSearchDropdownItem[]
  activeResultId?: string | null
  onSelectResult?: (id: string) => void
  dropdownLoading?: boolean
}

/**
 * Kid channel title search — YouTube-style pill input with optional results dropdown.
 */
export const ChannelVideoSearchBar = memo(function ChannelVideoSearchBar({
  id: idProp,
  value,
  onChange,
  channelLabel,
  className,
  onFocusChange,
  dropdownResults,
  activeResultId,
  onSelectResult,
  dropdownLoading = false,
}: ChannelVideoSearchBarProps) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  const hasQuery = value.trim().length > 0
  const showDropdown = Boolean(dropdownResults) && hasQuery && focused

  const handleFocusChange = useCallback(
    (next: boolean) => {
      setFocused(next)
      onFocusChange?.(next)
    },
    [onFocusChange]
  )

  useEffect(() => {
    if (!focused) return
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current
      if (!root || root.contains(event.target as Node)) return
      handleFocusChange(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [focused, handleFocusChange])

  const handleSelect = useCallback(
    (id: string) => {
      onSelectResult?.(id)
      handleFocusChange(false)
    },
    [onSelectResult, handleFocusChange]
  )

  return (
    <section className={cn('w-full', className)} aria-label="חיפוש סרטונים בערוץ">
      <div className="mb-2.5 text-right">
        <h3 className="text-base font-bold leading-tight text-yt-text sm:text-lg">חיפוש בערוץ</h3>
        <p className="mt-0.5 text-xs font-medium text-yt-textMuted sm:text-sm">
          {channelLabel ? (
            <>
              מצאו סרטון ב־<span className="text-yt-text">{channelLabel}</span>
            </>
          ) : (
            'הקלידו שם סרטון — התוצאות יופיעו מיד מתחת'
          )}
        </p>
      </div>

      <div ref={rootRef} className="relative z-30">
        <RtlSearchInput
          id={idProp}
          value={value}
          onChange={onChange}
          onFocusChange={handleFocusChange}
          placeholder="חפשו סרטון בערוץ…"
          aria-label="חיפוש לפי שם סרטון בערוץ הנבחר"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-autocomplete="list"
        />

        {showDropdown ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="תוצאות חיפוש בערוץ"
            className="absolute inset-x-0 top-[calc(100%+0.375rem)] overflow-hidden rounded-xl border border-yt-border bg-yt-surface shadow-lg shadow-black/20 ring-1 ring-black/5 dark:ring-white/10"
          >
            {dropdownLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-yt-textMuted">
                <LoadingSpinner className="h-4 w-4 border-2 border-yt-textMuted border-t-transparent" />
                מחפש…
              </div>
            ) : dropdownResults!.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-yt-textMuted">לא נמצאו סרטונים בערוץ.</p>
            ) : (
              <ul className="max-h-[min(50vh,280px)] overflow-y-auto py-1">
                {dropdownResults!.map((video) => {
                  const selected = video.id === activeResultId
                  return (
                    <li key={video.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          'flex w-full gap-2 px-2 py-2 text-right transition hover:bg-yt-surfaceHover',
                          selected && 'bg-yt-surfaceHover'
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelect(video.id)}
                      >
                        {video.thumbnail ? (
                          <img
                            src={video.thumbnail}
                            alt=""
                            className="h-11 w-[4.5rem] shrink-0 rounded-md object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-11 w-[4.5rem] shrink-0 rounded-md bg-yt-input" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-xs font-semibold leading-snug text-yt-text sm:text-sm">
                            {video.title}
                          </span>
                          {selected ? (
                            <span className="mt-0.5 block text-[10px] font-medium text-brand-600 dark:text-brand-400">
                              מנגן עכשיו
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
})
