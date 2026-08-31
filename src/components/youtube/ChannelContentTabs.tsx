import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

export type ChannelContentTab = 'home' | 'videos' | 'shorts' | 'playlists' | 'live'

const TAB_IDS: ChannelContentTab[] = ['home', 'videos', 'shorts', 'playlists', 'live']

const TAB_LABEL_KEYS: Record<ChannelContentTab, string> = {
  home: 'channels.tabHome',
  videos: 'channels.tabVideos',
  shorts: 'channels.tabShorts',
  playlists: 'channels.tabPlaylists',
  live: 'channels.tabLive',
}

type Props = {
  value: ChannelContentTab
  onChange: (tab: ChannelContentTab) => void
  className?: string
  /** When false, Shorts tab stays visible but content shows a blocked message. */
  allowShorts?: boolean
  /** Pill chips like YouTube related-rail filters (watch sidebar). */
  appearance?: 'underline' | 'pills'
}

/**
 * YouTube-style channel tabs.
 * Order: Home → Videos → Shorts → Playlists → Live.
 * Shorts label stays English (like YouTube).
 */
export function ChannelContentTabs({
  value,
  onChange,
  className,
  appearance = 'underline',
}: Props) {
  const { t } = useTranslation()

  if (appearance === 'pills') {
    return (
      <nav
        className={cn(
          'premium-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto pb-1',
          className
        )}
        aria-label={t('channels.contentNavAria')}
      >
        {TAB_IDS.map((id) => {
          const active = value === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(id)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition',
                active
                  ? 'bg-yt-text text-yt-bg'
                  : 'bg-yt-surfaceHover text-yt-text hover:bg-[#3f3f3f]'
              )}
            >
              {id === 'shorts' ? 'Shorts' : t(TAB_LABEL_KEYS[id])}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <nav
      className={cn(
        'premium-scrollbar flex flex-nowrap items-stretch gap-0 overflow-x-auto border-b border-yt-border',
        className
      )}
      aria-label={t('channels.contentNavAria')}
    >
      {TAB_IDS.map((id) => {
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              'relative shrink-0 whitespace-nowrap px-3 pb-2.5 pt-2 text-[13px] font-semibold transition xs:min-h-11 xs:px-3.5 xs:text-sm sm:min-h-12 sm:px-4 sm:text-[15px]',
              active ? 'text-yt-text' : 'text-yt-textMuted hover:text-yt-text'
            )}
          >
            {id === 'shorts' ? 'Shorts' : t(TAB_LABEL_KEYS[id])}
            {active ? (
              <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-yt-text" aria-hidden />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
