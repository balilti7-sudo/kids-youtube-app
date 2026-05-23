import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type YoutubeWatchLayoutProps = {
  main: ReactNode
  sidebar: ReactNode
  className?: string
}

/**
 * YouTube desktop watch page — RTL: main column on the right (2/3), sidebar on the left (1/3).
 */
export function YoutubeWatchLayout({ main, sidebar, className }: YoutubeWatchLayoutProps) {
  return (
    <div dir="rtl" className={cn('grid grid-cols-1 gap-6 lg:grid-cols-3', className)}>
      <div className="min-w-0 lg:col-span-2">{main}</div>
      <aside className="min-w-0 lg:col-span-1 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:pb-6">
        {sidebar}
      </aside>
    </div>
  )
}
