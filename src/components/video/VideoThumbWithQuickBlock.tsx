import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type VideoThumbWithQuickBlockProps = {
  thumbnailUrl: string | null
  className?: string
  imageClassName?: string
  quickBlock?: ReactNode
  onClick?: () => void
  playingBadge?: ReactNode
}

/** Compact playlist/search thumbnail with optional parent quick-block overlay. */
export function VideoThumbWithQuickBlock({
  thumbnailUrl,
  className,
  imageClassName,
  quickBlock,
  onClick,
  playingBadge,
}: VideoThumbWithQuickBlockProps) {
  return (
    <div className={cn('group relative shrink-0 overflow-hidden bg-yt-surfaceHover', className)}>
      <button type="button" onClick={onClick} className="block h-full w-full">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            className={cn('h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]', imageClassName)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-yt-textMuted">
            וידאו
          </div>
        )}
      </button>
      {quickBlock ? (
        <div className="pointer-events-auto absolute top-1 start-1 z-10 opacity-100 transition duration-200 sm:opacity-0 sm:group-hover:opacity-100">
          {quickBlock}
        </div>
      ) : null}
      {playingBadge}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/10" />
    </div>
  )
}
