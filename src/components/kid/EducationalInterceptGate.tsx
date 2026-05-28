import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import {
  completeInterceptSession,
  incrementInterceptVideoCount,
  INTERCEPT_CHANGED_EVENT,
  isInterceptSessionActive,
  readInterceptPendingVideo,
  readInterceptSceneProgress,
  readInterceptVideoCount,
  type InterceptSettings,
} from '../../lib/educationalIntercept'
import { getEducationalScene } from '../../data/educationalScenes'
import { EducationalInterceptModal } from './EducationalInterceptModal'

type GateContextValue = {
  onVideoPlaybackStarted: (videoId: string) => void
  videoCount: number
  isInterceptActive: boolean
}

const GateContext = createContext<GateContextValue | null>(null)

type Props = {
  settings: InterceptSettings
  children: ReactNode
  /** Called after the child completes the scene — resume the pending video. */
  onResumePlayback?: (pending: ReturnType<typeof readInterceptPendingVideo>) => void
}

/**
 * Wraps child routes: shows the educational intercept modal when active (refresh-proof)
 * and exposes playback counting for CleanPlayer.
 */
export function EducationalInterceptGate({ settings, children, onResumePlayback }: Props) {
  const hasKidToken = Boolean(getSavedChildAccessToken())
  const enabled = hasKidToken && settings.enabled
  const [videoCount, setVideoCount] = useState(() => readInterceptVideoCount())
  const [active, setActive] = useState(() => isInterceptSessionActive())
  const countedVideoRef = useRef<string | null>(null)

  const sync = useCallback(() => {
    setVideoCount(readInterceptVideoCount())
    setActive(isInterceptSessionActive())
  }, [])

  useEffect(() => {
    sync()
    const onChange = () => sync()
    window.addEventListener(INTERCEPT_CHANGED_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(INTERCEPT_CHANGED_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [sync])

  useEffect(() => {
    countedVideoRef.current = null
  }, [active])

  const onVideoPlaybackStarted = useCallback(
    (videoId: string) => {
      if (!enabled) return
      if (isInterceptSessionActive()) return
      if (countedVideoRef.current === videoId) return
      countedVideoRef.current = videoId
      setVideoCount(incrementInterceptVideoCount())
    },
    [enabled]
  )

  const handleComplete = useCallback(() => {
    const pending = readInterceptPendingVideo()
    completeInterceptSession()
    sync()
    onResumePlayback?.(pending)
  }, [onResumePlayback, sync])

  const ctx = useMemo(
    (): GateContextValue => ({
      onVideoPlaybackStarted,
      videoCount,
      isInterceptActive: enabled && active,
    }),
    [onVideoPlaybackStarted, videoCount, enabled, active]
  )

  const scene = getEducationalScene()
  const progress = readInterceptSceneProgress()

  return (
    <GateContext.Provider value={ctx}>
      {children}
      {enabled && active ? (
        <EducationalInterceptModal scene={scene} initialFixedItems={progress} onComplete={handleComplete} />
      ) : null}
    </GateContext.Provider>
  )
}

export function useEducationalInterceptGate() {
  return useContext(GateContext)
}
