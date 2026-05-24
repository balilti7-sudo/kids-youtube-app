import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { WatchTheaterModeContext } from '../../hooks/useWatchTheaterMode'

export type YoutubeWatchLayoutProps = {
  main: ReactNode
  sidebar: ReactNode
  className?: string
}

/**
 * YouTube desktop watch page — RTL: main column on the right (2/3), sidebar on the left (1/3).
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
          'grid grid-cols-1 gap-6 transition-[grid-template-columns,gap] duration-500 ease-in-out',
          theaterMode ? 'lg:grid-cols-1' : 'lg:grid-cols-3',
          className
        )}
      >
        <div
          className={cn(
            'min-w-0 transition-all duration-500 ease-in-out',
            theaterMode ? 'lg:col-span-1' : 'lg:col-span-2'
          )}
        >
          {main}
        </div>
        <aside
          className={cn(
            'min-w-0 transition-all duration-500 ease-in-out',
            theaterMode
              ? 'lg:static lg:col-span-1 lg:max-h-none lg:overflow-visible lg:border-t lg:border-yt-border lg:pt-6'
              : 'lg:col-span-1 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:border-s lg:border-yt-border lg:pb-6 lg:ps-3'
          )}
        >
          {sidebar}
        </aside>
      </div>
    </WatchTheaterModeContext.Provider>
  )
}
