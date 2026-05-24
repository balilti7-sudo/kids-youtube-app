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
  /** Parent quick-block overlay — top-start of thumbnail (RTL). */
  thumbnailAction?: ReactNode
  className?: string
}

function ThumbnailOverlays({
  active,
  playingLabel,
  thumbnailAction,
}: {
  active?: boolean
  playingLabel: string
  thumbnailAction?: ReactNode
}) {
  return (
    <>
      {thumbnailAction ? (
        <div className="pointer-events-auto absolute top-1.5 start-1.5 z-10 opacity-100 transition duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {thumbnailAction}
        </div>
      ) : null}
      {active ? (
        <span className="pointer-events-none absolute bottom-1 end-1 rounded-md bg-yt-red px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
          {playingLabel}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/10" />
    </>
  )
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
  thumbnailAction,
  className,
}: YoutubeVideoCardProps) {
  const titleEl = (
    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-yt-text">{title}</h3>
  )

  const metaEl = (
    <>
      {channelName ? <p className="mt-1 truncate text-xs text-yt-textMuted">{channelName}</p> : null}
      {metadata ? <p className="mt-0.5 truncate text-xs text-yt-textMuted">{metadata}</p> : null}
    </>
  )

  const thumbImage = thumbnail ? (
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
  )

  if (layout === 'row') {
    return (
      <article
        className={cn(
          'group flex w-full items-start gap-2 rounded-lg p-1 transition',
          active ? 'bg-yt-surface ring-1 ring-yt-border' : 'hover:bg-yt-surface/80',
          className
        )}
      >
        <div className="relative h-[94px] w-[168px] max-w-[42%] shrink-0 overflow-hidden rounded-xl bg-yt-surfaceHover sm:w-[168px]">
          <button type="button" onClick={onClick} className="block h-full w-full">
            {thumbImage}
          </button>
          <ThumbnailOverlays active={active} playingLabel={playingLabel} thumbnailAction={thumbnailAction} />
        </div>
        <button type="button" onClick={onClick} className="min-w-0 flex-1 py-0.5 text-right">
          {titleEl}
          {metaEl}
        </button>
        {actionSlot ? (
          <div className="flex shrink-0 flex-col justify-center gap-1 pt-1">{actionSlot}</div>
        ) : null}
      </article>
    )
  }

  return (
    <article className={cn('group flex w-full flex-col', className)}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-yt-surfaceHover">
        <button type="button" onClick={onClick} className="block h-full w-full">
          {thumbImage}
        </button>
        <ThumbnailOverlays active={active} playingLabel={playingLabel} thumbnailAction={thumbnailAction} />
      </div>
      <button type="button" onClick={onClick} className="mt-3 w-full text-right">
        {titleEl}
        {metaEl}
      </button>
      {actionSlot ? <div className="mt-2 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}
