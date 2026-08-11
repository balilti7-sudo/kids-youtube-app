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
 * Phone: stacked. Tablet (lg+): side-by-side. Theater mode stacks sidebar below the player.
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
          'mx-auto flex w-full max-w-full flex-col gap-3 overflow-x-hidden transition-all duration-500 ease-in-out sm:gap-4 lg:max-w-[1754px]',
          theaterMode ? 'lg:flex-col' : 'lg:flex-row lg:items-start lg:gap-4 xl:gap-6',
          className
        )}
      >
        <div
          className={cn(
            'w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-500 ease-in-out',
            theaterMode ? 'w-full' : 'lg:min-w-0 lg:flex-1'
          )}
        >
          {main}
        </div>
        <aside
          className={cn(
            'w-full min-w-0 max-w-full overflow-x-hidden transition-all duration-500 ease-in-out',
            theaterMode
              ? 'border-t border-yt-border pt-4 lg:static lg:max-h-none lg:overflow-visible'
              : 'lg:w-[360px] lg:shrink-0 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:overflow-x-hidden lg:ps-1 lg:pe-0 xl:w-[402px]'
          )}
        >
          {sidebar}
        </aside>
      </div>
    </WatchTheaterModeContext.Provider>
  )
}
