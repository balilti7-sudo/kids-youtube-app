import { memo } from 'react'
import { cn } from '../../lib/utils'
import { RtlSearchInput } from '../search/RtlSearchInput'

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
 * Kid channel title search — YouTube-style pill input.
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
  const trimmed = value.trim()
  const hasQuery = trimmed.length > 0
  const showingAll = !hasQuery || filteredCount === totalCount

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
            'הקלידו שם סרטון — הרשימה מתעדכנת מיד'
          )}
        </p>
      </div>

      <RtlSearchInput
        id={idProp}
        value={value}
        onChange={onChange}
        onFocusChange={onFocusChange}
        placeholder="חפשו סרטון בערוץ…"
        aria-label="חיפוש לפי שם סרטון בערוץ הנבחר"
      />

      <p className="mt-2 text-xs font-medium text-yt-textMuted sm:text-sm" aria-live="polite">
        {totalCount === 0
          ? 'אין עדיין סרטונים ברשימה'
          : showingAll
            ? `${totalCount} סרטונים בערוץ`
            : `מוצגים ${filteredCount} מתוך ${totalCount} סרטונים`}
      </p>
    </section>
  )
})
