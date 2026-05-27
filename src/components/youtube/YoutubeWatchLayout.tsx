import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { WatchTheaterModeContext } from '../../hooks/useWatchTheaterMode'

export type YoutubeWatchLayoutProps = {
  main: ReactNode
  sidebar: ReactNode
  className?: string
}

/**
 * YouTube desktop watch page — RTL: main column on the right (~2/3), sidebar on the left (~402px).
 * Mobile/tablet stays stacked: player first, sidebar below, no horizontal scroll.
 * Theater mode stacks sidebar below the player at full container width.
 */
export function YoutubeWatchLayout({ main, sidebar, className }: YoutubeWatchLayoutProps) {
  const [theaterMode, setTheaterMode] = useState(false)

  const toggleTheaterMode = useCallback(() => {
    setTheaterMode((prev) => !prev)
  }, [])

  const theaterContext = useMemo(
    () => ({ theaterMode, setTheaterMode, toggleTheaterMode }),
    [theaterMode, toggleTheaterMode]
  )

  return (
    <WatchTheaterModeContext.Provider value={theaterContext}>
      <div
        dir="rtl"
        className={cn(
          'mx-auto flex w-full max-w-full flex-col gap-3 overflow-x-hidden transition-all duration-500 ease-in-out sm:gap-4 xl:max-w-[1754px]',
          theaterMode ? 'xl:flex-col' : 'xl:flex-row xl:items-start xl:gap-4',
          className
        )}
      >
        <div
          className={cn(
            'w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-500 ease-in-out',
            theaterMode ? 'w-full' : 'xl:min-w-0 xl:flex-1'
          )}
        >
          {main}
        </div>
        <aside
          className={cn(
            'w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-500 ease-in-out',
            theaterMode
              ? 'border-t border-yt-border pt-4 xl:static xl:max-h-none xl:overflow-visible'
              : 'xl:w-[402px] xl:shrink-0 xl:sticky xl:top-14 xl:max-h-[calc(100dvh-3.5rem)] xl:overflow-y-auto xl:overflow-x-hidden xl:ps-1 xl:pe-0'
          )}
        >
          {sidebar}
        </aside>
      </div>
    </WatchTheaterModeContext.Provider>
  )
}
