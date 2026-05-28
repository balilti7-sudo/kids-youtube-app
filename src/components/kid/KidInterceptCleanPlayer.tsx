import { CleanPlayer, type CleanPlayerProps } from '../player/CleanPlayer'
import { useEducationalInterceptGate } from './EducationalInterceptGate'

/** CleanPlayer wired to educational intercept playback counting. */
export function KidInterceptCleanPlayer(props: CleanPlayerProps) {
  const gate = useEducationalInterceptGate()
  return <CleanPlayer {...props} onVideoPlaybackStarted={gate?.onVideoPlaybackStarted} />
}
