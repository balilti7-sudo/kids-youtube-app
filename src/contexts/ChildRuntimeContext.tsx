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
import {
  ACTIVE_CHILD_PROFILE_CHANGED_EVENT,
  getSavedActiveChildProfileId,
  resolveOwnerActiveDeviceId,
  saveActiveChildProfileId,
} from '../lib/activeDeviceSelection'
import type { InterceptPendingVideo } from '../lib/educationalIntercept'
import type { EducationalBreakIntervalMinutes } from '../types'
import { EDUCATIONAL_BREAKS_RUNTIME_ENABLED } from '../lib/educationalIntercept'
import {
  BEDTIME_CHANGED_EVENT,
  childCompleteIntercept,
  childCompleteScreenTimeChallenge,
  childConfirmBedtimeTask,
  childClaimTreasureChest,
  childEquipLionOutfit,
  childGetBedtimeState,
  childGetRaffleTicketSummary,
  childMarkInterceptItemFixed,
  childSpinDailyWheel,
  childTickScreenTime,
  childTryBeginPlayback,
  notifyBedtimeChanged,
  ownerClaimTreasureChest,
  ownerConfirmBedtimeTask,
  ownerGetBedtimeState,
  ownerSpinDailyWheel,
  parentApproveBedtime as parentApproveBedtimeRpc,
  parentGetBedtimeState as parentGetBedtimeStateRpc,
  parentStartScreenTime,
  parentUpdateBedtimeSettings as parentUpdateBedtimeSettingsRpc,
  readCachedChildRuntime,
  type BedtimeSettings,
  type BedtimeTask,
  type BedtimeTaskConfirmResult,
  type ChildBedtimeState,
  type CompleteInterceptResult,
  type DailyWheelSpinResult,
  type ParentBedtimeApproveResult,
  type ParentBedtimeState,
  type RaffleTicketSummary,
  type ScreenTimePhase,
  type ServerChildRuntime,
  type TreasureClaimResult,
} from '../lib/childRuntime'

const POLL_MS = 15_000
const MIN_SYNC_GAP_MS = 2500

export type ChildRuntimeContextValue = {
  runtime: ServerChildRuntime | null
  ready: boolean
  effectiveRuntime: ServerChildRuntime | null
  activeDeviceId: string | null
  raffleSummary: RaffleTicketSummary | null
  bedtimeState: ChildBedtimeState | null
  playbackBlocked: boolean
  isBlocked: boolean
  screenTimePhase: ScreenTimePhase
  remainingSeconds: number | null
  challengeTask: string | null
  interceptActive: boolean
  interceptVideoCount: number
  interceptWatchSeconds: number
  breakIntervalMinutes: EducationalBreakIntervalMinutes
  interceptPendingVideo: InterceptPendingVideo | null
  interceptSceneProgress: string[]
  refresh: (force?: boolean) => Promise<void>
  refreshRaffleSummary: () => Promise<void>
  refreshBedtimeState: () => Promise<void>
  confirmBedtimeTask: (
    task: BedtimeTask
  ) => Promise<{ data: BedtimeTaskConfirmResult | null; error: Error | null }>
  spinDailyWheel: () => Promise<{ data: DailyWheelSpinResult | null; error: Error | null }>
  claimTreasureChest: () => Promise<{ data: TreasureClaimResult | null; error: Error | null }>
  parentApproveBedtime: (
    deviceId: string,
    routineDate?: string | null
  ) => Promise<{ data: ParentBedtimeApproveResult | null; error: Error | null }>
  parentGetBedtimeState: (
    deviceId: string,
    routineDate?: string | null
  ) => Promise<{ data: ParentBedtimeState | null; error: Error | null }>
  parentUpdateBedtimeSettings: (
    deviceId: string,
    updates: {
      enabled?: boolean
      treasurePointsThreshold?: number
      treasurePrizeTitle?: string
      treasurePrizeDescription?: string
    }
  ) => Promise<{ data: BedtimeSettings | null; error: Error | null }>
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
  /** Active child profile in the single authenticated app flow (devices.id). */
  activeDeviceId?: string | null
}

export function ChildRuntimeProvider({ children, pollMs = POLL_MS, activeDeviceId = null }: Props) {
  const [runtime, setRuntime] = useState<ServerChildRuntime | null>(() => readCachedChildRuntime())
  const [raffleSummary, setRaffleSummary] = useState<RaffleTicketSummary | null>(null)
  const [bedtimeState, setBedtimeState] = useState<ChildBedtimeState | null>(null)
  const [ready, setReady] = useState(false)
  const [resolvedDeviceId, setResolvedDeviceId] = useState<string | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastSyncAtRef = useRef(0)

  const propDeviceId = activeDeviceId?.trim() || null
  const savedDeviceId = getSavedActiveChildProfileId()?.trim() || null
  const effectiveActiveDeviceId = propDeviceId || savedDeviceId || resolvedDeviceId

  useEffect(() => {
    if (propDeviceId || savedDeviceId) {
      setResolvedDeviceId(null)
      return
    }

    let cancelled = false
    void resolveOwnerActiveDeviceId(null).then((id) => {
      if (cancelled || !id) return
      setResolvedDeviceId(id)
      if (id !== getSavedActiveChildProfileId()) {
        saveActiveChildProfileId(id)
      }
    })

    return () => {
      cancelled = true
    }
  }, [propDeviceId, savedDeviceId])

  const refreshBedtimeState = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (token) {
      const { data, error } = await childGetBedtimeState(token)
      if (error) {
        console.warn('[ChildRuntime] child bedtime state failed', error.message)
        return
      }
      setBedtimeState(data)
      return
    }

    if (!effectiveActiveDeviceId) {
      setBedtimeState(null)
      return
    }
    const { data, error } = await ownerGetBedtimeState(effectiveActiveDeviceId)
    if (error) {
      console.warn('[ChildRuntime] owner bedtime state failed', error.message)
      return
    }
    setBedtimeState(data)
  }, [effectiveActiveDeviceId])

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
      if (effectiveActiveDeviceId) {
        await refreshBedtimeState()
      } else {
        setBedtimeState(null)
      }
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
        const [raffleRes, bedtimeRes] = await Promise.all([
          childGetRaffleTicketSummary(token),
          childGetBedtimeState(token),
        ])
        if (raffleRes.error) {
          console.warn('[ChildRuntime] raffle summary failed', raffleRes.error.message)
        } else {
          setRaffleSummary(raffleRes.data)
        }
        if (bedtimeRes.error) {
          console.warn('[ChildRuntime] bedtime state failed', bedtimeRes.error.message)
        } else {
          setBedtimeState(bedtimeRes.data)
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
  }, [effectiveActiveDeviceId, refreshBedtimeState])

  useEffect(() => {
    void sync(true)
    const id = window.setInterval(() => {
      void sync()
    }, pollMs)
    const onTokenChange = () => {
      void sync(true)
    }
    const onBedtimeChanged = () => {
      void refreshBedtimeState()
    }
    const onActiveProfileChanged = () => {
      if (!propDeviceId && !getSavedActiveChildProfileId()?.trim()) {
        void resolveOwnerActiveDeviceId(null).then((resolved) => {
          if (resolved) {
            setResolvedDeviceId(resolved)
            saveActiveChildProfileId(resolved)
          }
        })
      }
      void refreshBedtimeState()
    }
    window.addEventListener('safetube-kid-token-changed', onTokenChange)
    window.addEventListener(BEDTIME_CHANGED_EVENT, onBedtimeChanged)
    window.addEventListener(ACTIVE_CHILD_PROFILE_CHANGED_EVENT, onActiveProfileChanged)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('safetube-kid-token-changed', onTokenChange)
      window.removeEventListener(BEDTIME_CHANGED_EVENT, onBedtimeChanged)
      window.removeEventListener(ACTIVE_CHILD_PROFILE_CHANGED_EVENT, onActiveProfileChanged)
    }
  }, [sync, pollMs, refreshBedtimeState, propDeviceId])

  useEffect(() => {
    void refreshBedtimeState()
  }, [effectiveActiveDeviceId, refreshBedtimeState])

  const effectiveRuntime = runtime ?? readCachedChildRuntime()

  const confirmBedtimeTask = useCallback(
    async (task: BedtimeTask) => {
      const token = getSavedChildAccessToken()
      if (token) {
        console.info('[ChildRuntime] confirmBedtimeTask (child token)', { task })
        const result = await childConfirmBedtimeTask(token, task)
        if (result.error) {
          console.error('[ChildRuntime] confirmBedtimeTask failed', {
            task,
            message: result.error.message,
          })
          return result
        }
        if (result.data) {
          setBedtimeState((prev) =>
            prev
              ? {
                  ...prev,
                  teethConfirmed: result.data!.teethConfirmed,
                  bathroomConfirmed: result.data!.bathroomConfirmed,
                  tasksCompleted: result.data!.tasksCompleted,
                }
              : prev
          )
        }
        await refreshBedtimeState()
        notifyBedtimeChanged()
        return result
      }

      if (!effectiveActiveDeviceId) {
        console.error('[ChildRuntime] confirmBedtimeTask: missing activeDeviceId', { task })
        return { data: null, error: new Error('NO_ACTIVE_DEVICE') }
      }
      console.info('[ChildRuntime] confirmBedtimeTask start', { task, activeDeviceId: effectiveActiveDeviceId })
      const result = await ownerConfirmBedtimeTask(effectiveActiveDeviceId, task)
      if (result.error) {
        console.error('[ChildRuntime] confirmBedtimeTask failed', {
          task,
          activeDeviceId: effectiveActiveDeviceId,
          message: result.error.message,
        })
        return result
      }
      if (result.data) {
        setBedtimeState((prev) =>
          prev
            ? {
                ...prev,
                teethConfirmed: result.data!.teethConfirmed,
                bathroomConfirmed: result.data!.bathroomConfirmed,
                tasksCompleted: result.data!.tasksCompleted,
              }
            : prev
        )
      }
      await refreshBedtimeState()
      notifyBedtimeChanged()
      console.info('[ChildRuntime] confirmBedtimeTask done', {
        task,
        activeDeviceId: effectiveActiveDeviceId,
        data: result.data,
      })
      return result
    },
    [effectiveActiveDeviceId, refreshBedtimeState]
  )

  const spinDailyWheel = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (token) {
      const result = await childSpinDailyWheel(token)
      if (!result.error) {
        await refreshBedtimeState()
        notifyBedtimeChanged()
      }
      return result
    }
    if (!effectiveActiveDeviceId) {
      return { data: null, error: new Error('NO_ACTIVE_DEVICE') }
    }
    const result = await ownerSpinDailyWheel(effectiveActiveDeviceId)
    if (!result.error) {
      await refreshBedtimeState()
      notifyBedtimeChanged()
    }
    return result
  }, [effectiveActiveDeviceId, refreshBedtimeState])

  const claimTreasureChest = useCallback(async () => {
    const token = getSavedChildAccessToken()
    if (token) {
      const result = await childClaimTreasureChest(token)
      if (!result.error) {
        await refreshBedtimeState()
        notifyBedtimeChanged()
      }
      return result
    }
    if (!effectiveActiveDeviceId) {
      return { data: null, error: new Error('NO_ACTIVE_DEVICE') }
    }
    const result = await ownerClaimTreasureChest(effectiveActiveDeviceId)
    if (!result.error) {
      await refreshBedtimeState()
      notifyBedtimeChanged()
    }
    return result
  }, [effectiveActiveDeviceId, refreshBedtimeState])

  const parentApproveBedtime = useCallback(
    async (deviceId: string, routineDate?: string | null) => {
      const result = await parentApproveBedtimeRpc(deviceId, routineDate)
      if (
        !result.error &&
        (effectiveActiveDeviceId === deviceId || effectiveRuntime?.deviceId === deviceId)
      ) {
        await refreshBedtimeState()
        notifyBedtimeChanged()
      }
      return result
    },
    [effectiveActiveDeviceId, effectiveRuntime?.deviceId, refreshBedtimeState]
  )

  const parentGetBedtimeState = useCallback(async (deviceId: string, routineDate?: string | null) => {
    return parentGetBedtimeStateRpc(deviceId, routineDate)
  }, [])

  const parentUpdateBedtimeSettings = useCallback(
    async (
      deviceId: string,
      updates: {
        enabled?: boolean
        treasurePointsThreshold?: number
        treasurePrizeTitle?: string
        treasurePrizeDescription?: string
      }
    ) => {
      const result = await parentUpdateBedtimeSettingsRpc(deviceId, updates)
      if (!result.error && effectiveActiveDeviceId === deviceId) {
        await refreshBedtimeState()
        notifyBedtimeChanged()
      }
      return result
    },
    [effectiveActiveDeviceId, refreshBedtimeState]
  )

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
    async (_pending: InterceptPendingVideo) => {
      if (!EDUCATIONAL_BREAKS_RUNTIME_ENABLED) return true

      const token = getSavedChildAccessToken()
      if (!token) return true
      const { allowed, error } = await childTryBeginPlayback(token, _pending)
      if (error) {
        console.warn('[ChildRuntime] tryBeginPlayback', error.message)
        return false
      }
      await sync(true)
      return allowed
    },
    [sync]
  )

  const reportVideoPlaybackStarted = useCallback(async (_videoId: string) => {
    /* Educational breaks use cumulative watch timer, not per-video counts */
  }, [])

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
      activeDeviceId: effectiveActiveDeviceId,
      raffleSummary,
      bedtimeState,
      playbackBlocked: Boolean(eff?.playbackBlocked),
      isBlocked: Boolean(eff?.isBlocked),
      screenTimePhase: eff?.screenTimePhase ?? 'idle',
      remainingSeconds: eff?.remainingSeconds ?? null,
      challengeTask: eff?.challengeTask ?? null,
      interceptActive: EDUCATIONAL_BREAKS_RUNTIME_ENABLED ? Boolean(eff?.interceptActive) : false,
      interceptVideoCount: eff?.interceptVideoCount ?? 0,
      interceptWatchSeconds: eff?.interceptWatchSeconds ?? 0,
      breakIntervalMinutes: eff?.breakIntervalMinutes ?? 30,
      interceptPendingVideo: eff?.interceptPendingVideo ?? null,
      interceptSceneProgress: eff?.interceptSceneProgress ?? [],
      refresh: sync,
      refreshRaffleSummary,
      refreshBedtimeState,
      confirmBedtimeTask,
      spinDailyWheel,
      claimTreasureChest,
      parentApproveBedtime,
      parentGetBedtimeState,
      parentUpdateBedtimeSettings,
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
    effectiveActiveDeviceId,
    raffleSummary,
    bedtimeState,
    sync,
    refreshRaffleSummary,
    refreshBedtimeState,
    confirmBedtimeTask,
    spinDailyWheel,
    claimTreasureChest,
    parentApproveBedtime,
    parentGetBedtimeState,
    parentUpdateBedtimeSettings,
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
