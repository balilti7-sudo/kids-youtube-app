import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KidBrowseChannel } from '../../lib/contentTags/tagBrowseRank'
import { SafeTubeChannelAvatar } from '../ui/SafeTubeChannelAvatar'
import { cn } from '../../lib/utils'

type Props = {
  channels: KidBrowseChannel[]
  activeYoutubeChannelId?: string | null
  onSelectChannel: (youtubeChannelId: string) => void
  hideThumbnails?: boolean
  className?: string
}

export function KidRecommendedChannelsRow({
  channels,
  activeYoutubeChannelId,
  onSelectChannel,
  hideThumbnails = false,
  className,
}: Props) {
  const { t } = useTranslation()

  if (channels.length === 0) return null

  return (
    <section className={cn('min-w-0', className)} aria-label={t('contentTags.recommendedForYou')}>
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <Sparkles className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <h2 className="text-sm font-bold text-yt-text">{t('contentTags.recommendedForYou')}</h2>
      </div>
      <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {channels.map((channel) => {
          const selected = channel.youtubeChannelId === activeYoutubeChannelId
          return (
            <button
              key={channel.channelId}
              type="button"
              onClick={() => onSelectChannel(channel.youtubeChannelId)}
              className={cn(
                'flex w-[5.5rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl p-1 transition touch-manipulation sm:w-[6rem]',
                selected ? 'opacity-100' : 'opacity-90 hover:opacity-100'
              )}
            >
              <SafeTubeChannelAvatar
                name={channel.channelName}
                thumbnail={channel.channelThumbnail}
                hide={hideThumbnails}
                className={cn(
                  'h-[4.25rem] w-[4.25rem] rounded-full sm:h-[4.75rem] sm:w-[4.75rem]',
                  selected && 'ring-2 ring-amber-400/80 ring-offset-2 ring-offset-yt-bg'
                )}
              />
              <span className="line-clamp-2 w-full text-center text-[11px] font-semibold leading-tight text-yt-text">
                {channel.channelName}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
