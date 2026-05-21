import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ChannelVideoSearchBarProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  totalCount: number
  filteredCount: number
  channelLabel?: string | null
  className?: string
  onFocusChange?: (focused: boolean) => void
}

/**
 * Kid channel title search — single inline field, instant filter via parent state.
 */
export const ChannelVideoSearchBar = memo(function ChannelVideoSearchBar({
  id: idProp,
  value,
  onChange,
  totalCount,
  filteredCount,
  channelLabel,
  className,
  onFocusChange,
}: ChannelVideoSearchBarProps) {
  const autoId = useId()
  const inputId = idProp ?? autoId
  const inputRef = useRef<HTMLInputElement>(null)
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    if (inputRef.current === document.activeElement) return
    setLocalValue(value)
  }, [value])

  const trimmed = localValue.trim()
  const hasQuery = trimmed.length > 0
  const showingAll = !hasQuery || filteredCount === totalCount

  const commitChange = useCallback(
    (next: string) => {
      setLocalValue(next)
      onChange(next)
    },
    [onChange]
  )

  const clearInput = useCallback(() => {
    commitChange('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [commitChange])

  return (
    <section
      className={cn('w-full', className)}
      aria-label="חיפוש סרטונים בערוץ"
    >
      <div className="mb-2.5 text-right">
        <h3 className="text-base font-bold leading-tight text-zinc-100 sm:text-lg">חיפוש בערוץ</h3>
        <p className="mt-0.5 text-xs font-medium text-zinc-400 sm:text-sm">
          {channelLabel ? (
            <>
              מצאו סרטון ב־<span className="text-zinc-200">{channelLabel}</span>
            </>
          ) : (
            'הקלידו שם סרטון — הרשימה מתעדכנת מיד'
          )}
        </p>
      </div>

      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          חיפוש לפי שם סרטון בערוץ הנבחר
        </label>

        {/* type="text" — avoids native mobile search/clear chrome (duplicate icons) */}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="search"
          value={localValue}
          onChange={(e) => commitChange(e.target.value)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder="חפשו סרטון בערוץ…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          dir="rtl"
          enterKeyHint="search"
          className={cn(
            'h-12 w-full rounded-2xl border border-zinc-600/90 bg-zinc-900 text-base font-medium text-zinc-50 shadow-sm outline-none transition placeholder:text-zinc-500',
            'focus:border-brand-500/70 focus:ring-2 focus:ring-brand-500/25',
            'padding-inline-start-[2.75rem]',
            hasQuery ? 'padding-inline-end-[2.75rem]' : 'padding-inline-end-4'
          )}
        />

        {/* RTL: inline-start = right edge — one subtle search icon */}
        <span
          className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-zinc-500"
          aria-hidden
        >
          <Search className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
        </span>

        {hasQuery ? (
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-y-0 end-2.5 my-auto flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearInput}
            aria-label="מחק את החיפוש"
          >
            <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs font-medium text-zinc-500 sm:text-sm" aria-live="polite">
        {totalCount === 0
          ? 'אין עדיין סרטונים ברשימה'
          : showingAll
            ? `${totalCount} סרטונים בערוץ`
            : `מוצגים ${filteredCount} מתוך ${totalCount} סרטונים`}
      </p>
    </section>
  )
})
