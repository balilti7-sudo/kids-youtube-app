import type { ReactNode } from 'react'
import { JUICY_THUMB_INNER_CLASS, useJuicyPointerBurst, useJuicyUiEnabled, juicyPressableClass } from '../../contexts/JuicyUiContext'
import { usePrefetchStreamWhenVisible } from '../../hooks/usePrefetchStreamWhenVisible'
import { cn } from '../../lib/utils'

type Props = {
  title: string
  thumbnail: string | null
  active?: boolean
  onClick?: () => void
  actionSlot?: ReactNode
  /** When set, `/api/stream` is prefetched once the card is near the viewport. */
  prefetchVideoId?: string | null
  className?: string
  /** Horizontal shelf vs sidebar row */
  variant?: 'shelf' | 'row'
}

export function YoutubeShortCard({
  title,
  thumbnail,
  active,
  onClick,
  actionSlot,
  prefetchVideoId,
  className,
  variant = 'shelf',
}: Props) {
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()
  const prefetchRef = usePrefetchStreamWhenVisible(prefetchVideoId)
  const wrapClick = (handler?: () => void) => ({
    onPointerDown: juicyBurst,
    onClick: handler,
  })

  const thumb = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-700/80',
        variant === 'shelf' ? 'aspect-[9/16] w-[132px] sm:w-[148px]' : 'aspect-[9/16] h-[120px] w-[68px] shrink-0',
        juicy && 'group/juicy'
      )}
    >
      <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'block h-full w-full')}>
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className={cn('h-full w-full object-cover', juicy && JUICY_THUMB_INNER_CLASS)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">Short</div>
        )}
      </button>
      {active ? (
        <span className="pointer-events-none absolute bottom-1 end-1 rounded bg-sky-500 px-1 py-0.5 text-[9px] font-bold text-white">
          מנגן
        </span>
      ) : null}
    </div>
  )

  if (variant === 'row') {
    return (
      <article ref={prefetchRef} className={cn('group flex w-full items-start gap-2', className)}>
        {thumb}
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'min-w-0 flex-1 py-1 text-start')}>
            <h3 className="line-clamp-3 text-sm font-bold leading-snug text-yt-text">{title}</h3>
            <p className="mt-1 text-[11px] text-sky-300/90">Short</p>
          </button>
          {actionSlot ? <div className="shrink-0 pt-0.5">{actionSlot}</div> : null}
        </div>
      </article>
    )
  }

  return (
    <article ref={prefetchRef} className={cn('flex w-[132px] shrink-0 flex-col sm:w-[148px]', className)}>
      {thumb}
      <button type="button" {...wrapClick(onClick)} className={juicyPressableClass(juicy, 'mt-2 w-full text-start')}>
        <h3 className="line-clamp-2 text-xs font-bold leading-snug text-zinc-100">{title}</h3>
      </button>
      {actionSlot ? <div className="mt-1.5 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}
