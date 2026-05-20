import { Search, X } from 'lucide-react'
import { Input } from '../ui/Input'

export type ChannelVideoSearchBarProps = {
  id: string
  value: string
  onChange: (value: string) => void
  totalCount: number
  filteredCount: number
  /** Shown under the title when set (e.g. channel name). */
  channelLabel?: string | null
  className?: string
}

/**
 * Kid-friendly instant title filter for approved channel video lists (client-side only).
 */
export function ChannelVideoSearchBar({
  id,
  value,
  onChange,
  totalCount,
  filteredCount,
  channelLabel,
  className,
}: ChannelVideoSearchBarProps) {
  const trimmed = value.trim()
  const showingAll = trimmed.length === 0 || filteredCount === totalCount

  return (
    <section
      className={`w-full rounded-2xl border-2 border-slate-200/90 bg-white px-3 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 sm:px-4 sm:py-4 ${className ?? ''}`}
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
        <label htmlFor={id} className="sr-only">
          חיפוש לפי שם סרטון בערוץ הנבחר
        </label>
        <Search
          className="pointer-events-none absolute end-3 top-1/2 z-[1] h-7 w-7 -translate-y-1/2 text-slate-400 dark:text-zinc-500"
          aria-hidden
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="הקלידו כאן את שם הסרטון…"
          autoComplete="off"
          dir="rtl"
          enterKeyHint="search"
          className={`min-h-[52px] rounded-2xl border-2 border-slate-200 bg-slate-50/80 text-lg font-medium text-slate-900 shadow-inner placeholder:text-slate-400 focus:bg-white dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900 ${
            trimmed ? 'ps-12 pe-14' : 'pe-14 ps-4'
          }`}
        />
        {trimmed ? (
          <button
            type="button"
            className="absolute start-3 top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-slate-200/90 text-slate-700 transition hover:bg-slate-300/90 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
            onClick={() => onChange('')}
            aria-label="מחק את החיפוש"
          >
            <X className="h-6 w-6" strokeWidth={2.5} aria-hidden />
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
}
