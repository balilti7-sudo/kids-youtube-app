import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type YoutubeVideoCardProps = {
  title: string
  thumbnail: string | null
  channelName?: string | null
  metadata?: string | null
  active?: boolean
  playingLabel?: string
  layout?: 'grid' | 'row'
  onClick?: () => void
  actionSlot?: ReactNode
  className?: string
}

/**
 * Native YouTube-style video card — grid feed or compact sidebar row.
 */
export function YoutubeVideoCard({
  title,
  thumbnail,
  channelName,
  metadata,
  active,
  playingLabel = 'מנגן עכשיו',
  layout = 'grid',
  onClick,
  actionSlot,
  className,
}: YoutubeVideoCardProps) {
  const thumb = (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-yt-surfaceHover">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs font-medium text-yt-textMuted">
          וידאו
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/10" />
      {active ? (
        <span className="absolute bottom-2 end-2 rounded-md bg-yt-red px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
          {playingLabel}
        </span>
      ) : null}
    </div>
  )

  const textBlock = (
    <div className="min-w-0 flex-1 text-right">
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-yt-text sm:text-base">{title}</h3>
      {channelName ? (
        <p className="mt-1 truncate text-xs text-yt-textMuted sm:text-sm">{channelName}</p>
      ) : null}
      {metadata ? <p className="mt-0.5 truncate text-xs text-yt-textMuted">{metadata}</p> : null}
    </div>
  )

  if (layout === 'row') {
    return (
      <article
        className={cn(
          'group flex w-full gap-3 rounded-xl p-2 transition',
          active ? 'bg-yt-surface ring-1 ring-yt-border' : 'hover:bg-yt-surface/80',
          className
        )}
      >
        <button type="button" onClick={onClick} className="flex min-w-0 flex-1 gap-3 text-right">
          <div className="relative w-[168px] max-w-[42%] shrink-0 sm:w-40">{thumb}</div>
          {textBlock}
        </button>
        {actionSlot ? <div className="flex shrink-0 flex-col justify-center gap-1">{actionSlot}</div> : null}
      </article>
    )
  }

  return (
    <article className={cn('group flex w-full flex-col', className)}>
      <button type="button" onClick={onClick} className="w-full text-right">
        {thumb}
        <div className="mt-3">{textBlock}</div>
      </button>
      {actionSlot ? <div className="mt-2 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}

