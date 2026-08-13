import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type YoutubeWatchVideoDetailsProps = {
  title: string
  channelName?: string | null
  channelThumbnail?: string | null
  subtitle?: string | null
  actions?: ReactNode
  className?: string
}

/** Title + channel row below the watch player (YouTube mobile/desktop style). */
export function YoutubeWatchVideoDetails({
  title,
  channelName,
  channelThumbnail,
  subtitle,
  actions,
  className,
}: YoutubeWatchVideoDetailsProps) {
  const initial = (channelName || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <div className={cn('mt-3 px-0.5 sm:mt-3.5', className)}>
      <h1 className="text-base font-bold leading-snug text-yt-text xs:text-lg sm:text-xl">{title}</h1>

      <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-yt-surfaceHover text-sm font-bold text-yt-text"
            aria-hidden
          >
            {channelThumbnail ? (
              <img src={channelThumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0">
            {channelName ? (
              <p className="truncate text-sm font-semibold text-yt-text">{channelName}</p>
            ) : null}
            {subtitle ? <p className="mt-0.5 truncate text-xs text-yt-textMuted">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}
