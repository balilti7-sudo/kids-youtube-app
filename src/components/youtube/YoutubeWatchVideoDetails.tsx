import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type YoutubeWatchVideoDetailsProps = {
  title: string
  channelName?: string | null
  subtitle?: string | null
  actions?: ReactNode
  className?: string
}

/** Title + channel row below the watch-page player (YouTube desktop style). */
export function YoutubeWatchVideoDetails({
  title,
  channelName,
  subtitle,
  actions,
  className,
}: YoutubeWatchVideoDetailsProps) {
  return (
    <div className={cn('mt-3 px-0.5 sm:mt-4', className)}>
      <h1 className="text-lg font-bold leading-snug text-yt-text sm:text-xl">{title}</h1>
      {(channelName || subtitle) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {channelName ? (
            <p className="text-sm font-medium text-yt-text">{channelName}</p>
          ) : null}
          {subtitle ? <p className="text-sm text-yt-textMuted">{subtitle}</p> : null}
        </div>
      )}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
