import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { WhitelistedChannel } from '../../types'
import { useJuicyPointerBurst, useJuicyUiEnabled, juicyPressableClass } from '../../contexts/JuicyUiContext'
import { useLongPress } from '../../hooks/useLongPress'
import { cn } from '../../lib/utils'

import { SafeTubeChannelAvatar } from '../ui/SafeTubeChannelAvatar'

type Props = {
  channels: WhitelistedChannel[]
  activeYoutubeChannelId?: string | null
  onSelectChannel: (youtubeChannelId: string) => void
  onRemoveChannel?: (channel: WhitelistedChannel) => void
  hideThumbnails?: boolean
  className?: string
}

function ChannelCarouselItem({
  channel,
  isActive,
  hideThumbnails,
  onSelect,
  onRemove,
  setActiveRef,
}: {
  channel: WhitelistedChannel
  isActive: boolean
  hideThumbnails: boolean
  onSelect: () => void
  onRemove?: () => void
  setActiveRef?: (el: HTMLButtonElement | null) => void
}) {
  const { t } = useTranslation()
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()
  const longPress = useLongPress(() => onRemove?.(), 550)
  const { consumeLongPress, ...pressHandlers } = longPress

  const handleClick = useCallback(() => {
    if (consumeLongPress()) return
    onSelect()
  }, [consumeLongPress, onSelect])

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-1.5 px-1 [scroll-snap-align:center]">
      <button
        ref={setActiveRef}
        type="button"
        onPointerDown={(e) => {
          juicyBurst(e)
          if (onRemove) pressHandlers.onPointerDown(e)
        }}
        onPointerUp={onRemove ? pressHandlers.onPointerUp : undefined}
        onPointerLeave={onRemove ? pressHandlers.onPointerLeave : undefined}
        onPointerCancel={onRemove ? pressHandlers.onPointerCancel : undefined}
        onClick={handleClick}
        aria-current={isActive ? 'page' : undefined}
        aria-label={t('channels.switchToChannelAria', { name: channel.channel_name })}
        className={cn(
          'flex flex-col items-center gap-1.5 rounded-2xl',
          juicyPressableClass(juicy, isActive ? 'opacity-100' : 'opacity-85 hover:opacity-100')
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
          <SafeTubeChannelAvatar
            name={channel.channel_name}
            thumbnail={channel.channel_thumbnail}
            hide={hideThumbnails}
            className="h-full w-full rounded-full"
          />
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
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="absolute -start-0.5 -top-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-950 text-red-400 shadow ring-1 ring-red-500/40"
          aria-label={t('channels.removeAria', { name: channel.channel_name })}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export function ChildChannelsNavCarousel({
  channels,
  activeYoutubeChannelId = null,
  onSelectChannel,
  onRemoveChannel,
  hideThumbnails = false,
  className,
}: Props) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const scroller = scrollRef.current
    const active = activeRef.current
    if (!scroller || !active) return

    // Scroll only the carousel strip — never scrollIntoView (that jumps the whole page).
    const scrollerRect = scroller.getBoundingClientRect()
    const activeRect = active.getBoundingClientRect()
    const delta =
      activeRect.left + activeRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2)
    if (Math.abs(delta) < 4) return
    scroller.scrollBy({ left: delta, behavior: 'smooth' })
  }, [activeYoutubeChannelId])

  return (
    <nav
      aria-label={t('channels.quickSwitchAria')}
      className={cn('mt-4 border-t border-zinc-800/80 pt-4', className)}
    >
      <div
        ref={scrollRef}
        className="premium-scrollbar flex items-center gap-3 overflow-x-auto pb-1 pe-1 ps-0.5 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]"
      >
        {channels.map((channel) => {
          const isActive = channel.youtube_channel_id === activeYoutubeChannelId
          return (
            <ChannelCarouselItem
              key={channel.id}
              channel={channel}
              isActive={isActive}
              hideThumbnails={hideThumbnails}
              onSelect={() => onSelectChannel(channel.youtube_channel_id)}
              onRemove={onRemoveChannel ? () => onRemoveChannel(channel) : undefined}
              setActiveRef={
                isActive
                  ? (el) => {
                      ;(activeRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </nav>
  )
}
