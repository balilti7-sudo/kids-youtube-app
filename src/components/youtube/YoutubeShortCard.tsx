import type { ReactNode } from 'react'
import { JUICY_THUMB_INNER_CLASS, useJuicyPointerBurst, useJuicyUiEnabled, juicyPressableClass } from '../../contexts/JuicyUiContext'
import { cn } from '../../lib/utils'

type Props = {
  title: string
  thumbnail: string | null
  active?: boolean
  hideThumbnail?: boolean
  onClick?: () => void
  actionSlot?: ReactNode
  className?: string
  /** Horizontal shelf vs sidebar row */
  variant?: 'shelf' | 'row'
}

export function YoutubeShortCard({
  title,
  thumbnail,
  active,
  hideThumbnail = false,
  onClick,
  actionSlot,
  className,
  variant = 'shelf',
}: Props) {
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()
  const wrapClick = (handler?: () => void) => ({
    onPointerDown: juicyBurst,
    onClick: handler,
  })

  const thumb = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-yt-surfaceHover ring-1 ring-yt-border',
        variant === 'shelf'
          ? 'aspect-[9/16] w-full max-w-[148px] min-w-[108px] xs:min-w-[120px] sm:max-w-none sm:w-[148px]'
          : 'aspect-[9/16] h-[100px] w-[56px] shrink-0 xs:h-[120px] xs:w-[68px]',
        juicy && 'group/juicy'
      )}
    >
      <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'block h-full w-full')}>
        {hideThumbnail || !thumbnail ? (
          <div className="flex h-full w-full items-center justify-center bg-black text-[10px] text-yt-textMuted">
            {hideThumbnail ? '' : 'Short'}
          </div>
        ) : (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className={cn('h-full w-full object-cover', juicy && JUICY_THUMB_INNER_CLASS)}
          />
        )}
      </button>
      {active ? (
        <span className="pointer-events-none absolute bottom-1 end-1 rounded bg-yt-red px-1 py-0.5 text-[9px] font-bold text-white">
          מנגן
        </span>
      ) : null}
    </div>
  )

  if (variant === 'row') {
    return (
      <article className={cn('group flex w-full items-start gap-2', className)}>
        {thumb}
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'min-w-0 flex-1 py-1 text-start')}>
            <h3 className="line-clamp-3 text-sm font-bold leading-snug text-yt-text">{title}</h3>
            <p className="mt-1 text-[11px] text-yt-textMuted">Short</p>
          </button>
          {actionSlot ? <div className="shrink-0 pt-0.5">{actionSlot}</div> : null}
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'flex shrink-0 flex-col',
        variant === 'shelf' && 'w-full min-w-0 max-w-[148px] sm:w-[148px]',
        className
      )}
    >
      {thumb}
      <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'mt-2 w-full text-start')}>
        <h3 className="line-clamp-2 text-xs font-bold leading-snug text-yt-text">{title}</h3>
      </button>
      {actionSlot ? <div className="mt-1.5 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}
