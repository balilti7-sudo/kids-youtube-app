import { createContext, useContext } from 'react'

export type WatchTheaterModeContextValue = {
  theaterMode: boolean
  setTheaterMode: (value: boolean | ((prev: boolean) => boolean)) => void
  toggleTheaterMode: () => void
}

export const WatchTheaterModeContext = createContext<WatchTheaterModeContextValue | null>(null)

export function useWatchTheaterMode() {
  return useContext(WatchTheaterModeContext)
}
