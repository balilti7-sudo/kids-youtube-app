import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { childAwardRaffleTicket } from '../../lib/childRuntime'
import type { InterceptSettings } from '../../lib/educationalIntercept'
import { getEducationalScene } from '../../data/educationalScenes'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
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
  onResumePlayback?: (pending: { videoId: string } | null) => void
}

export function EducationalInterceptGate({ settings, children, onResumePlayback }: Props) {
  const hasKidToken = Boolean(getSavedChildAccessToken())
  const runtime = useChildRuntimeOptional()
  const lion = useLionProgressionOptional()

  const serverEnabled = runtime?.effectiveRuntime?.educationalInterceptEnabled ?? settings.enabled
  const enabled = hasKidToken && serverEnabled
  const active = enabled && Boolean(runtime?.interceptActive)
  const videoCount = runtime?.interceptVideoCount ?? 0
  const progress = runtime?.interceptSceneProgress ?? []
  const pendingVideo = runtime?.interceptPendingVideo ?? null

  const onVideoPlaybackStarted = useCallback(
    (videoId: string) => {
      if (!enabled || !runtime) return
      if (runtime.interceptActive) return
      void runtime.reportVideoPlaybackStarted(videoId)
    },
    [enabled, runtime]
  )

  const handleComplete = useCallback(() => {
    if (!runtime) {
      onResumePlayback?.(pendingVideo)
      return
    }

    void (async () => {
      const pending = runtime.interceptPendingVideo ?? pendingVideo
      const { data, error } = await runtime.completeIntercept()
      if (error) {
        console.warn('[EducationalInterceptGate] complete failed', error.message)
        return
      }

      const token = getSavedChildAccessToken()
      if (token) {
        const raffleRes = await childAwardRaffleTicket(
          token,
          'educational_intercept',
          `session_${Date.now()}`
        )
        if (raffleRes.error) {
          console.warn('[EducationalInterceptGate] raffle award failed', raffleRes.error.message)
        }
        await runtime.refreshRaffleSummary()
      }

      const resume = () => onResumePlayback?.(pending)

      if (lion && data) {
        if (data.leveledUp) {
          lion.showLevelUp(data.lionLevel)
          window.setTimeout(resume, 2800)
          return
        }
      }

      resume()
    })()
  }, [runtime, pendingVideo, onResumePlayback, lion])

  const ctx = useMemo(
    (): GateContextValue => ({
      onVideoPlaybackStarted,
      videoCount,
      isInterceptActive: active,
    }),
    [onVideoPlaybackStarted, videoCount, active]
  )

  const scene = getEducationalScene()

  return (
    <GateContext.Provider value={ctx}>
      {children}
      {active ? (
        <EducationalInterceptModal
          scene={scene}
          initialFixedItems={progress}
          onMarkItemFixed={(itemId) => runtime?.markInterceptItemFixed(itemId) ?? Promise.resolve([])}
          onComplete={handleComplete}
        />
      ) : null}
    </GateContext.Provider>
  )
}

export function useEducationalInterceptGate() {
  return useContext(GateContext)
}
