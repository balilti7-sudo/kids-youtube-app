import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { childAwardRaffleTicket } from '../../lib/childRuntime'
import {
  EDUCATIONAL_BREAKS_RUNTIME_ENABLED,
  type InterceptPendingVideo,
  type InterceptSettings,
} from '../../lib/educationalIntercept'
import { getEducationalScene } from '../../data/educationalScenes'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { EducationalInterceptModal } from './EducationalInterceptModal'

type GateContextValue = {
  onVideoPlaybackStarted: (videoId: string) => void
  isInterceptActive: boolean
}

const GateContext = createContext<GateContextValue | null>(null)

const STABLE_GATE_VALUE: GateContextValue = {
  onVideoPlaybackStarted: () => {},
  isInterceptActive: false,
}

type Props = {
  settings: InterceptSettings
  children: ReactNode
  onResumePlayback?: (pending: InterceptPendingVideo | null) => void
}

export function EducationalInterceptGate({ settings, children, onResumePlayback }: Props) {
  if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) {
    return <GateContext.Provider value={STABLE_GATE_VALUE}>{children}</GateContext.Provider>
  }

  return (
    <EducationalInterceptGateActive settings={settings} onResumePlayback={onResumePlayback}>
      {children}
    </EducationalInterceptGateActive>
  )
}

function EducationalInterceptGateActive({ settings, children, onResumePlayback }: Props) {
  const hasKidToken = Boolean(getSavedChildAccessToken())
  const runtime = useChildRuntimeOptional()
  const lion = useLionProgressionOptional()

  const serverEnabled = runtime?.effectiveRuntime?.educationalInterceptEnabled ?? settings.enabled
  const enabled = hasKidToken && serverEnabled
  const active = enabled && Boolean(runtime?.interceptActive)
  const progress = runtime?.interceptSceneProgress ?? []
  const pendingVideo = runtime?.interceptPendingVideo ?? null

  const onVideoPlaybackStarted = useCallback(
    (_videoId: string) => {
      /* Time-based breaks use cumulative watch seconds, not per-video counts */
    },
    []
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

      if (lion && data?.leveledUp) {
        lion.showLevelUp(data.lionLevel)
        window.setTimeout(resume, 2800)
        return
      }

      resume()
    })()
  }, [runtime, pendingVideo, onResumePlayback, lion])

  const ctx = useMemo(
    (): GateContextValue => ({
      onVideoPlaybackStarted,
      isInterceptActive: active,
    }),
    [onVideoPlaybackStarted, active]
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

/** Client-side playback gate before starting a new video (local-only fallback). */
export function clientTryBeginPlayback(
  _deviceId: string | null,
  _pending: InterceptPendingVideo,
  _settings: InterceptSettings
): boolean {
  return true
}
