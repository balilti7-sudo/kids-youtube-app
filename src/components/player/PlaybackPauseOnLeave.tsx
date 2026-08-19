import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { pauseAllPlayback } from '../lib/playbackController'
import { usePausePlaybackOnLeave } from '../hooks/usePausePlaybackOnLeave'

/** Mount once under BrowserRouter — pauses media on background and route changes. */
export function PlaybackPauseOnLeave() {
  usePausePlaybackOnLeave(true)

  const location = useLocation()
  useEffect(() => {
    pauseAllPlayback()
  }, [location.pathname])

  return null
}
