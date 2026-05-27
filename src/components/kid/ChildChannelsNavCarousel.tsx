import { Home, Tv } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { WhitelistedChannel } from '../../types'
import { cn } from '../../lib/utils'

type Props = {
  channels: WhitelistedChannel[]
  activeYoutubeChannelId?: string | null
  onHome: () => void
  onSelectChannel: (youtubeChannelId: string) => void
  className?: string
}

export function ChildChannelsNavCarousel({
  channels,
  activeYoutubeChannelId = null,
  onHome,
  onSelectChannel,
  className,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const atHome = !activeYoutubeChannelId

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeYoutubeChannelId])

  return (
    <nav
      aria-label="מעבר מהיר בין ערוצים"
      className={cn('mt-4 border-t border-zinc-800/80 pt-4', className)}
    >
      <div
        ref={scrollRef}
        className="premium-scrollbar flex items-center gap-3 overflow-x-auto pb-1 pe-1 ps-0.5 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]"
      >
        <button
          type="button"
          onClick={onHome}
          aria-current={atHome ? 'page' : undefined}
          className={cn(
            'flex shrink-0 scroll-ml-2 flex-col items-center gap-1.5 rounded-2xl px-1 transition [scroll-snap-align:start]',
            atHome ? 'opacity-100' : 'opacity-90 hover:opacity-100'
          )}
        >
          <span
            className={cn(
              'flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full bg-gradient-to-br shadow-lg ring-2 transition sm:h-[4.75rem] sm:w-[4.75rem]',
              atHome
                ? 'from-amber-400 via-orange-500 to-rose-500 shadow-orange-950/40 ring-amber-200/90 scale-105'
                : 'from-amber-500/90 via-orange-500/90 to-rose-500/90 shadow-black/30 ring-white/15 hover:scale-[1.03]'
            )}
          >
            <Home className="h-8 w-8 text-white drop-shadow-sm sm:h-9 sm:w-9" strokeWidth={2.25} aria-hidden />
          </span>
          <span
            className={cn(
              'max-w-[4.5rem] truncate text-center text-[11px] font-black leading-tight',
              atHome ? 'text-amber-300' : 'text-zinc-400'
            )}
          >
            בית
          </span>
        </button>

        {channels.map((channel) => {
          const isActive = channel.youtube_channel_id === activeYoutubeChannelId
          return (
            <button
              key={channel.id}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => onSelectChannel(channel.youtube_channel_id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={`מעבר לערוץ ${channel.channel_name}`}
              className={cn(
                'flex shrink-0 flex-col items-center gap-1.5 rounded-2xl px-1 transition [scroll-snap-align:center]',
                isActive ? 'opacity-100' : 'opacity-85 hover:opacity-100'
              )}
            >
              <span
                className={cn(
                  'relative flex h-[4.25rem] w-[4.25rem] items-center justify-center overflow-hidden rounded-full bg-zinc-800 ring-2 transition sm:h-[4.75rem] sm:w-[4.75rem]',
                  isActive
                    ? 'ring-sky-400 shadow-lg shadow-sky-950/50 scale-105'
                    : 'ring-zinc-700 hover:ring-zinc-500 hover:scale-[1.03]'
                )}
              >
                {channel.channel_thumbnail ? (
                  <img
                    src={channel.channel_thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Tv className="h-9 w-9 text-zinc-500" aria-hidden />
                )}
                {isActive ? (
                  <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-inset ring-sky-300/40" aria-hidden />
                ) : null}
              </span>
              <span
                className={cn(
                  'max-w-[4.75rem] truncate text-center text-[11px] font-bold leading-tight',
                  isActive ? 'text-sky-200' : 'text-zinc-500'
                )}
              >
                {channel.channel_name}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
