import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Props = {
  title: string
  thumbnail: string | null
  active?: boolean
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
  onClick,
  actionSlot,
  className,
  variant = 'shelf',
}: Props) {
  const thumb = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-700/80',
        variant === 'shelf' ? 'aspect-[9/16] w-[132px] sm:w-[148px]' : 'aspect-[9/16] h-[120px] w-[68px] shrink-0'
      )}
    >
      <button type="button" onClick={onClick} className="block h-full w-full">
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
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
      <article className={cn('group flex w-full items-start gap-2', className)}>
        {thumb}
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <button type="button" onClick={onClick} className="min-w-0 flex-1 py-1 text-start">
            <h3 className="line-clamp-3 text-sm font-bold leading-snug text-yt-text">{title}</h3>
            <p className="mt-1 text-[11px] text-sky-300/90">Short</p>
          </button>
          {actionSlot ? <div className="shrink-0 pt-0.5">{actionSlot}</div> : null}
        </div>
      </article>
    )
  }

  return (
    <article className={cn('flex w-[132px] shrink-0 flex-col sm:w-[148px]', className)}>
      {thumb}
      <button type="button" onClick={onClick} className="mt-2 w-full text-start">
        <h3 className="line-clamp-2 text-xs font-bold leading-snug text-zinc-100">{title}</h3>
      </button>
      {actionSlot ? <div className="mt-1.5 flex justify-end">{actionSlot}</div> : null}
    </article>
  )
}
