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
import { getSavedChildAccessToken } from '../lib/childDevice'
import type { InterceptPendingVideo } from '../lib/educationalIntercept'
import {
  childCompleteIntercept,
  childCompleteScreenTimeChallenge,
  childEquipLionOutfit,
  childGetRaffleTicketSummary,
  childMarkInterceptItemFixed,
  childReportVideoPlaybackStarted,
  childTickScreenTime,
  childTryBeginPlayback,
  parentStartScreenTime,
  readCachedChildRuntime,
  type CompleteInterceptResult,
  type RaffleTicketSummary,
  type ScreenTimePhase,
  type ServerChildRuntime,
} from '../lib/childRuntime'

const POLL_MS = 15_000
const MIN_SYNC_GAP_MS = 2500

export type ChildRuntimeContextValue = {
  runtime: ServerChildRuntime | null
  ready: boolean
  effectiveRuntime: ServerChildRuntime | null
  raffleSummary: RaffleTicketSummary | null
  playbackBlocked: boolean
  isBlocked: boolean
  screenTimePhase: ScreenTimePhase
  remainingSeconds: number | null
  challengeTask: string | null
  interceptActive: boolean
  interceptVideoCount: number
  interceptPendingVideo: InterceptPendingVideo | null
  interceptSceneProgress: string[]
  refresh: (force?: boolean) => Promise<void>
  refreshRaffleSummary: () => Promise<void>
  startScreenTimeSession: (deviceId: string, limitMinutes: number) => Promise<{ error: Error | null }>
  completeChallengeAndLock: () => Promise<{ error: Error | null }>
  tryBeginPlayback: (pending: InterceptPendingVideo) => Promise<boolean>
  reportVideoPlaybackStarted: (videoId: string) => Promise<void>
  markInterceptItemFixed: (itemId: string) => Promise<string[]>
  completeIntercept: () => Promise<{ data: CompleteInterceptResult | null; error: Error | null }>
  equipLionOutfit: (outfitId: string) => Promise<{ error: Error | null }>
}

const ChildRuntimeContext = createContext<ChildRuntimeContextValue | null>(null)

type Props = {
  children: ReactNode
  pollMs?: number
}

export function ChildRuntimeProvider({ children, pollMs = POLL_MS }: Props) {
  const [runtime, setRuntime] = useState<ServerChildRuntime | null>(() => readCachedChildRuntime())
  const [raffleSummary, setRaffleSummary] = useState<RaffleTicketSummary | null>(null)
  const [ready, setReady] = useState(false)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastSyncAtRef = useRef(0)

  const refreshRaffleSummary = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (!token) {
      setRaffleSummary(null)
      return
    }
    const { data, error } = await childGetRaffleTicketSummary(token)
    if (error) {
      console.warn('[ChildRuntime] raffle summary failed', error.message)
      return
    }
    setRaffleSummary(data)
  }, [])

  const sync = useCallback(async (force = false) => {
    const token = getSavedChildAccessToken()

    if (!token) {
      setRuntime(null)
      setRaffleSummary(null)
      setReady(true)
      return
    }

    const now = Date.now()
    if (!force && inFlightRef.current) {
      await inFlightRef.current
      return
    }
    if (!force && now - lastSyncAtRef.current < MIN_SYNC_GAP_MS) {
      return
    }

    const run = (async () => {
      const { data, error } = await childTickScreenTime(token)
      lastSyncAtRef.current = Date.now()
      if (data) {
        setRuntime(data)
        const raffleRes = await childGetRaffleTicketSummary(token)
        if (raffleRes.error) {
          console.warn('[ChildRuntime] raffle summary failed', raffleRes.error.message)
        } else {
          setRaffleSummary(raffleRes.data)
        }
      }
      if (error) console.warn('[ChildRuntime] tick failed', error.message)
      setReady(true)
    })()

    inFlightRef.current = run
    try {
      await run
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null
    }
  }, [])

  useEffect(() => {
    void sync(true)
    const id = window.setInterval(() => {
      void sync()
    }, pollMs)
    const onTokenChange = () => {
      void sync(true)
    }
    window.addEventListener('safetube-kid-token-changed', onTokenChange)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('safetube-kid-token-changed', onTokenChange)
    }
  }, [sync, pollMs])

  const effectiveRuntime = runtime ?? readCachedChildRuntime()

  const startScreenTimeSession = useCallback(
    async (deviceId: string, limitMinutes: number) => {
      const result = await parentStartScreenTime(deviceId, limitMinutes)
      await sync(true)
      return result
    },
    [sync]
  )

  const completeChallengeAndLock = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (!token) return { error: new Error('NO_TOKEN') }
    const result = await childCompleteScreenTimeChallenge(token)
    await sync(true)
    return result
  }, [sync])

  const tryBeginPlayback = useCallback(
    async (pending: InterceptPendingVideo) => {
      const token = getSavedChildAccessToken()
      if (!token) return true
      const { allowed, error } = await childTryBeginPlayback(token, pending)
      if (error) {
        console.warn('[ChildRuntime] tryBeginPlayback', error.message)
        return false
      }
      await sync(true)
      return allowed
    },
    [sync]
  )

  const reportVideoPlaybackStarted = useCallback(
    async (videoId: string) => {
      const token = getSavedChildAccessToken()
      if (!token || !videoId.trim()) return
      const { error } = await childReportVideoPlaybackStarted(token, videoId)
      if (error) console.warn('[ChildRuntime] reportVideoPlaybackStarted', error.message)
      await sync(true)
    },
    [sync]
  )

  const markInterceptItemFixed = useCallback(
    async (itemId: string) => {
      const token = getSavedChildAccessToken()
      if (!token) return []
      const { progress, error } = await childMarkInterceptItemFixed(token, itemId)
      if (error) console.warn('[ChildRuntime] markInterceptItemFixed', error.message)
      await sync(true)
      return progress
    },
    [sync]
  )

  const completeIntercept = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (!token) return { data: null, error: new Error('NO_TOKEN') }
    const result = await childCompleteIntercept(token)
    await sync(true)
    return result
  }, [sync])

  const equipLionOutfit = useCallback(
    async (outfitId: string) => {
      const token = getSavedChildAccessToken()
      if (!token) return { error: new Error('NO_TOKEN') }
      const result = await childEquipLionOutfit(token, outfitId)
      await sync(true)
      return { error: result.error }
    },
    [sync]
  )

  const value = useMemo((): ChildRuntimeContextValue => {
    const eff = effectiveRuntime
    return {
      runtime,
      ready,
      effectiveRuntime: eff,
      raffleSummary,
      playbackBlocked: Boolean(eff?.playbackBlocked),
      isBlocked: Boolean(eff?.isBlocked),
      screenTimePhase: eff?.screenTimePhase ?? 'idle',
      remainingSeconds: eff?.remainingSeconds ?? null,
      challengeTask: eff?.challengeTask ?? null,
      interceptActive: Boolean(eff?.interceptActive),
      interceptVideoCount: eff?.interceptVideoCount ?? 0,
      interceptPendingVideo: eff?.interceptPendingVideo ?? null,
      interceptSceneProgress: eff?.interceptSceneProgress ?? [],
      refresh: sync,
      refreshRaffleSummary,
      startScreenTimeSession,
      completeChallengeAndLock,
      tryBeginPlayback,
      reportVideoPlaybackStarted,
      markInterceptItemFixed,
      completeIntercept,
      equipLionOutfit,
    }
  }, [
    runtime,
    ready,
    effectiveRuntime,
    raffleSummary,
    sync,
    refreshRaffleSummary,
    startScreenTimeSession,
    completeChallengeAndLock,
    tryBeginPlayback,
    reportVideoPlaybackStarted,
    markInterceptItemFixed,
    completeIntercept,
    equipLionOutfit,
  ])

  return <ChildRuntimeContext.Provider value={value}>{children}</ChildRuntimeContext.Provider>
}

export function useChildRuntime() {
  const ctx = useContext(ChildRuntimeContext)
  if (!ctx) throw new Error('useChildRuntime must be used within ChildRuntimeProvider')
  return ctx
}

export function useChildRuntimeOptional() {
  return useContext(ChildRuntimeContext)
}
