import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type YoutubeSuggestedListProps = {
  title?: string
  children: ReactNode
  className?: string
}

/** Scrollable sidebar list wrapper — YouTube “Up next / suggested” column. */
export function YoutubeSuggestedList({
  title = 'סרטונים מומלצים',
  children,
  className,
}: YoutubeSuggestedListProps) {
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {title ? (
        <h2 className="mb-2 px-0.5 text-sm font-bold text-yt-text">{title}</h2>
      ) : null}
      <ul className="no-scrollbar flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}
