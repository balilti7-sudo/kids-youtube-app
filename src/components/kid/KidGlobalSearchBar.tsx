import { memo } from 'react'
import { cn } from '../../lib/utils'
import { RtlSearchInput } from '../search/RtlSearchInput'

export type KidGlobalSearchBarProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  onSubmit: (query: string) => void
  className?: string
}

/**
 * Kid layout — global YouTube search (PIN-gated by parent page).
 * Separate from ChannelVideoSearchBar which filters only the active channel.
 */
export const KidGlobalSearchBar = memo(function KidGlobalSearchBar({
  id,
  value,
  onChange,
  onSubmit,
  className,
}: KidGlobalSearchBarProps) {
  return (
    <section className={cn('w-full', className)} aria-label="חיפוש ב-YouTube">
      <div className="mb-2 text-right">
        <h3 className="text-sm font-bold leading-tight text-yt-text">חיפוש ב-YouTube</h3>
        <p className="mt-0.5 text-[11px] font-medium text-yt-textMuted">
          חיפוש בכל YouTube — נדרש PIN הורה
        </p>
      </div>
      <RtlSearchInput
        id={id}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder="חפשו בכל YouTube…"
        aria-label="חיפוש גלובלי ב-YouTube"
      />
    </section>
  )
})
