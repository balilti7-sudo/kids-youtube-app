import type { ReactNode } from 'react'
import { JUICY_THUMB_INNER_CLASS, useJuicyPointerBurst, useJuicyUiEnabled, juicyPressableClass } from '../../contexts/JuicyUiContext'
import { usePrefetchStreamWhenVisible } from '../../hooks/usePrefetchStreamWhenVisible'
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
  /** When set, `/api/stream` is prefetched once the card is near the viewport. */
  prefetchVideoId?: string | null
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
        <div className="pointer-events-auto absolute top-1 start-1 z-10 opacity-100 transition duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {thumbnailAction}
        </div>
      ) : null}
      {active ? (
        <span className="pointer-events-none absolute bottom-1 end-1 rounded-[2px] bg-yt-red px-1 py-0.5 text-[10px] font-bold leading-none text-white">
          {playingLabel}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/10" />
    </>
  )
}

const ROW_THUMB_CLASS =
  'relative h-[94px] w-[168px] shrink-0 overflow-hidden rounded-[4px] bg-yt-surfaceHover'

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
  prefetchVideoId,
  className,
}: YoutubeVideoCardProps) {
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()
  const prefetchRef = usePrefetchStreamWhenVisible(prefetchVideoId)

  const wrapClick = (handler?: () => void) => ({
    onPointerDown: juicyBurst,
    onClick: handler,
  })

  const titleEl = (
    <h3 className="line-clamp-2 text-sm font-bold leading-[1.35] text-yt-text">{title}</h3>
  )

  const metaEl = (
    <>
      {channelName ? (
        <p className="mt-1 line-clamp-1 text-xs text-yt-textMuted">{channelName}</p>
      ) : null}
      {metadata ? (
        <p className="mt-0.5 line-clamp-1 text-xs text-yt-textMuted">{metadata}</p>
      ) : null}
    </>
  )

  const thumbImage = thumbnail ? (
    <img
      src={thumbnail}
      alt=""
      loading="lazy"
      className={cn('h-full w-full object-cover', juicy ? JUICY_THUMB_INNER_CLASS : 'transition duration-200 group-hover:scale-[1.02]')}
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-xs font-medium text-yt-textMuted">
      וידאו
    </div>
  )

  if (layout === 'row') {
    return (
      <article
        ref={prefetchRef}
        className={cn(
          'group flex w-full items-start gap-2 rounded-sm py-1 transition-colors duration-150',
          active ? 'bg-yt-surface/90' : 'hover:bg-yt-surface/70',
          className
        )}
      >
        <div className={cn(ROW_THUMB_CLASS, juicy && 'group/juicy')}>
          <button
            type="button"
            {...wrapClick(onClick)}
            className={juicyPressableClass(juicy, 'block h-full w-full')}
          >
            {thumbImage}
          </button>
          <ThumbnailOverlays active={active} playingLabel={playingLabel} thumbnailAction={thumbnailAction} />
        </div>
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <button
            type="button"
            {...wrapClick(onClick)}
            className={juicyPressableClass(juicy, 'min-w-0 flex-1 py-0.5 text-start')}
          >
            {titleEl}
            {metaEl}
          </button>
          {actionSlot ? (
            <div className="flex shrink-0 flex-col justify-start gap-1 pt-0.5">{actionSlot}</div>
          ) : null}
        </div>
      </article>
    )
  }

  return (
    <article ref={prefetchRef} className={cn('group flex w-full flex-col', className)}>
      <div className={cn('relative aspect-video w-full overflow-hidden rounded-xl bg-yt-surfaceHover', juicy && 'group/juicy')}>
        <button
          type="button"
          {...wrapClick(onClick)}
          className={juicyPressableClass(juicy, 'block h-full w-full')}
        >
          {thumbImage}
        </button>
        <ThumbnailOverlays active={active} playingLabel={playingLabel} thumbnailAction={thumbnailAction} />
      </div>
      <button
        type="button"
        {...wrapClick(onClick)}
        className={juicyPressableClass(juicy, 'mt-3 w-full text-start')}
      >
        {titleEl}
        {metaEl}
      </button>
      {actionSlot ? <div className="mt-2 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}
