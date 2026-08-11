import { cn } from '../../lib/utils'

export type ChannelContentTab = 'home' | 'videos' | 'shorts' | 'live'

const TABS: { id: ChannelContentTab; label: string }[] = [
  { id: 'home', label: 'דף הבית' },
  { id: 'videos', label: 'סרטונים' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'live', label: 'שידורים חיים' },
]

type Props = {
  value: ChannelContentTab
  onChange: (tab: ChannelContentTab) => void
  /** Hide Shorts tab when device policy disables Shorts. */
  showShortsTab?: boolean
  className?: string
}

/**
 * YouTube channel-style content tabs. Community is intentionally omitted.
 */
export function ChannelContentTabs({ value, onChange, showShortsTab = true, className }: Props) {
  const visible = TABS.filter((t) => t.id !== 'shorts' || showShortsTab)

  return (
    <nav
      className={cn(
        'premium-scrollbar flex gap-1 overflow-x-auto border-b border-yt-border pb-0 [-webkit-overflow-scrolling:touch]',
        className
      )}
      aria-label="ניווט תוכן הערוץ"
    >
      {visible.map((tab) => {
        const active = value === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-2.5 pb-2.5 pt-2 text-xs font-semibold transition xs:px-3 xs:pb-3 xs:text-sm sm:px-4',
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
