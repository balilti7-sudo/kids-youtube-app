import { cn } from '../../lib/utils'

export type ChannelContentTab = 'home' | 'videos' | 'shorts' | 'live' | 'playlists'

const TABS: { id: ChannelContentTab; label: string }[] = [
  { id: 'home', label: 'דף הבית' },
  { id: 'videos', label: 'סרטונים' },
  { id: 'shorts', label: 'שורטים' },
  { id: 'live', label: 'שידור חי' },
  { id: 'playlists', label: 'פלייליסטים' },
]

type Props = {
  value: ChannelContentTab
  onChange: (tab: ChannelContentTab) => void
  className?: string
}

/**
 * YouTube channel-style content tabs. Community is intentionally omitted.
 * All primary tabs stay visible (no horizontal hide).
 */
export function ChannelContentTabs({ value, onChange, className }: Props) {
  return (
    <nav
      className={cn('flex flex-wrap gap-x-0.5 border-b border-yt-border', className)}
      aria-label="ניווט תוכן הערוץ"
    >
      {TABS.map((tab) => {
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-2.5 pb-2.5 pt-2 text-[13px] font-semibold transition xs:px-3 xs:text-sm sm:px-3.5 sm:text-[15px]',
              active ? 'text-yt-text' : 'text-yt-textMuted hover:text-yt-text'
            )}
          >
            {tab.label}
            {active ? (
              <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-yt-text" aria-hidden />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
