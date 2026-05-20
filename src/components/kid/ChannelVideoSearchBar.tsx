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
  /** Parent can skip heavy updates (e.g. auto-select video) while the kid is typing. */
  onFocusChange?: (focused: boolean) => void
}

/**
 * Kid-friendly instant title filter input (client-side). Keeps local input state while
 * focused so parent re-renders do not steal the caret.
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
  const showingAll = trimmed.length === 0 || filteredCount === totalCount

  const commitChange = useCallback(
    (next: string) => {
      setLocalValue(next)
      onChange(next)
    },
    [onChange]
  )

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  const clearInput = useCallback(() => {
    commitChange('')
    focusInput()
  }, [commitChange, focusInput])

  return (
    <section
      className={cn(
        'w-full rounded-2xl border-2 border-slate-200/90 bg-white px-3 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 sm:px-4 sm:py-4',
        className
      )}
      aria-label="חיפוש סרטונים בערוץ"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-950/80">
          <Search className="h-6 w-6 text-brand-600 dark:text-brand-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-bold leading-tight text-slate-900 dark:text-zinc-50 sm:text-xl">
            חיפוש בערוץ
          </h3>
          <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">
            {channelLabel ? (
              <>
                מצאו סרטון ב־<span className="font-bold text-slate-800 dark:text-zinc-200">{channelLabel}</span>
              </>
            ) : (
              'הקלידו שם סרטון — הרשימה מתעדכנת מיד'
            )}
          </p>
        </div>
      </div>

      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          חיפוש לפי שם סרטון בערוץ הנבחר
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={localValue}
          onChange={(e) => commitChange(e.target.value)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder="הקלידו כאן את שם הסרטון…"
          autoComplete="off"
          dir="rtl"
          enterKeyHint="search"
          className={cn(
            'min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-slate-50/80 text-lg font-medium text-slate-900 shadow-inner outline-none ring-brand-500 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900',
            trimmed ? 'ps-10 pe-11' : 'px-11'
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-y-0 end-2 my-auto flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/80 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
          onMouseDown={(e) => e.preventDefault()}
          onClick={focusInput}
          aria-label="מקד לשדה החיפוש"
        >
          <Search className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </button>
        {trimmed ? (
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-y-0 start-2 my-auto flex h-7 w-7 items-center justify-center rounded-full bg-slate-200/90 text-slate-600 transition hover:bg-slate-300/90 dark:bg-zinc-700/90 dark:text-zinc-200 dark:hover:bg-zinc-600"
            onMouseDown={(e) => e.preventDefault()}
            onClick={clearInput}
            aria-label="מחק את החיפוש"
          >
            <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-zinc-400" aria-live="polite">
        {totalCount === 0
          ? 'אין עדיין סרטונים ברשימה'
          : showingAll
            ? `${totalCount} סרטונים בערוץ`
            : `מוצגים ${filteredCount} מתוך ${totalCount} סרטונים`}
      </p>
    </section>
  )
})
