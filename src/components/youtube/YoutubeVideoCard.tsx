import type { ReactNode, MouseEvent } from 'react'
import { JUICY_THUMB_INNER_CLASS, useJuicyPointerBurst, useJuicyUiEnabled, juicyPressableClass } from '../../contexts/JuicyUiContext'
import { cn } from '../../lib/utils'

export type YoutubeVideoCardProps = {
  title: string
  thumbnail: string | null
  channelName?: string | null
  metadata?: string | null
  /** Clock duration overlay on the thumbnail (e.g. `12:34`). */
  durationLabel?: string | null
  active?: boolean
  playingLabel?: string
  layout?: 'grid' | 'row'
  onClick?: () => void
  actionSlot?: ReactNode
  /** Parent quick-block overlay — top-start of thumbnail (RTL). */
  thumbnailAction?: ReactNode
  /** Parental policy: show a black tile instead of the poster image. */
  hideThumbnail?: boolean
  className?: string
}

function ThumbnailOverlays({
  active,
  playingLabel,
  thumbnailAction,
  durationLabel,
}: {
  active?: boolean
  playingLabel: string
  thumbnailAction?: ReactNode
  durationLabel?: string | null
}) {
  return (
    <>
      {thumbnailAction ? (
        <div className="pointer-events-auto absolute top-1 start-1 z-10 opacity-100 transition duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {thumbnailAction}
        </div>
      ) : null}
      {active ? (
        <span className="pointer-events-none absolute bottom-1 left-1 z-[1] rounded-[2px] bg-yt-red px-1 py-0.5 text-[10px] font-bold leading-none text-white">
          {playingLabel}
        </span>
      ) : null}
      {durationLabel ? (
        <span className="pointer-events-none absolute bottom-1 end-1 z-[2] rounded-[3px] bg-black/85 px-1 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums shadow-sm">
          {durationLabel}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/10" />
    </>
  )
}

const ROW_THUMB_CLASS =
  'relative h-[94px] w-[168px] shrink-0 overflow-hidden rounded-lg bg-yt-surfaceHover'

/**
 * Native YouTube-style video card — grid feed or compact sidebar row.
 */
export function YoutubeVideoCard({
  title,
  thumbnail,
  channelName,
  metadata,
  durationLabel,
  active,
  playingLabel = 'מנגן עכשיו',
  layout = 'grid',
  onClick,
  actionSlot,
  thumbnailAction,
  hideThumbnail = false,
  className,
}: YoutubeVideoCardProps) {
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()

  const wrapClick = (handler?: () => void) => ({
    onPointerDown: juicyBurst,
    onMouseDown: (e: MouseEvent) => {
      // Keep the player in view — don't let focus scroll the tapped card into the viewport.
      if (handler) e.preventDefault()
    },
    onClick: handler,
  })

  const titleEl = (
    <h3 className="line-clamp-2 text-[13px] font-bold leading-[1.35] text-yt-text xs:text-sm">{title}</h3>
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

  const thumbImage =
    hideThumbnail || !thumbnail ? (
      <div className="flex h-full w-full items-center justify-center bg-black text-xs font-medium text-zinc-500">
        {hideThumbnail ? '' : 'וידאו'}
      </div>
    ) : (
      <img
        src={thumbnail}
        alt=""
        loading="lazy"
        className={cn('h-full w-full object-cover', juicy ? JUICY_THUMB_INNER_CLASS : 'transition duration-200 group-hover:scale-[1.02]')}
      />
    )

  const overlays = (
    <ThumbnailOverlays
      active={active}
      playingLabel={playingLabel}
      thumbnailAction={thumbnailAction}
      durationLabel={durationLabel}
    />
  )

  if (layout === 'row') {
    return (
      <article
        className={cn(
          'group flex w-full items-start gap-2 rounded-xl px-1 py-1.5 transition-colors duration-150',
          active ? 'bg-yt-surfaceHover/90' : 'hover:bg-yt-surfaceHover/60',
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
          {overlays}
        </div>
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <button
            type="button"
            {...wrapClick(onClick)}
            className={juicyPressableClass(juicy, 'min-w-0 flex-1 py-0.5 text-start')}
          >
            <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-yt-text sm:text-sm">
              {title}
            </h3>
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
    <article className={cn('group flex w-full flex-col', className)}>
      <div className={cn('relative aspect-video w-full overflow-hidden rounded-xl bg-yt-surfaceHover', juicy && 'group/juicy')}>
        <button
          type="button"
          {...wrapClick(onClick)}
          className={juicyPressableClass(juicy, 'block h-full w-full')}
        >
          {thumbImage}
        </button>
        {overlays}
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
