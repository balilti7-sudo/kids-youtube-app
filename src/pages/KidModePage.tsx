import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ListMusic, Play, Search, ShieldAlert, Smartphone, Unplug, Users } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { KidGlobalSearchSection } from '../components/kid/KidGlobalSearchSection'
import { YoutubeVideoCard } from '../components/youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { YoutubeSuggestedList } from '../components/youtube/YoutubeSuggestedList'
import { KidPlaylistView } from '../components/kid/KidPlaylistView'
import { AddToPlaylistButton } from '../components/playlists/AddToPlaylistButton'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Modal } from '../components/ui/Modal'
import { useAuth } from '../hooks/useAuth'
import {
  childHeartbeat,
  childMarkOffline,
  clearChildAccessToken,
  getChildAllowedChannels,
  getChildCachedChannelVideos,
  getChildDeviceState,
  getSavedChildAccessToken,
  pairChildDevice,
  saveChildAccessToken,
  type ChildAllowedChannel,
  type ChildDeviceState,
} from '../lib/childDevice'
import { isLocalParentSessionValid, writeLocalParentSession, LOCAL_PARENT_SESSION_MS } from '../lib/localParentAdmin'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { parsePairingCodeFromLocationSearch, parsePairingCodeFromScan } from '../lib/pairingCodeFromQr'
import { requestPairingReminderEmail } from '../lib/requestPairingReminderEmail'
import { SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY } from '../lib/safetubeSessionKeys'
import { supabase } from '../lib/supabase'
import { setAppModeKid } from '../lib/appMode'
import { lockManagementAppShell } from '../lib/lockParentApp'
import { setParentEntryIntent } from '../lib/parentEntryIntent'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import type { ChannelVideoItem } from '../lib/youtube'
import { searchYouTubeVideos } from '../lib/youtube'
import type { YouTubeVideoResult } from '../types'
import { evaluateKidScreenBreak } from '../lib/kidScreenControl'
import { KidScreenBreakOverlay } from '../components/kid/KidScreenBreakOverlay'
import { useKidWatchTimeReporter } from '../hooks/useKidWatchTimeReporter'
import { CleanPlayer } from '../components/player/CleanPlayer'
import { SafeTubeBrandMark } from '../components/branding/SafeTubeBrandMark'
import { ThemeToggle } from '../components/theme/ThemeToggle'
import type { Html5Qrcode } from 'html5-qrcode'

const KID_APP_DISPLAY_NAME = 'SafeTube Kids'
const PARENT_MODE_UNLOCK_MS = 10 * 60 * 1000
const PARENT_TAB_LONG_PRESS_MS = 650

function KidQrScanModal({
  open,
  onClose,
  scanCameraError,
}: {
  open: boolean
  onClose: () => void
  scanCameraError: string | null
}) {
  return (
    <Modal open={open} onClose={onClose} title="סריקת QR לחיבור">
      <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
        כוונו את המצלמה לקוד ה־QR (לרוב מהטלפון של ההורה). הקישור מכיל את קוד הצימוד — אחרי זיהוי החיבור נשמר במכשיר.
      </p>
      <div id="kid-mode-html5-qrcode-reader" className="min-h-[260px] w-full overflow-hidden rounded-xl bg-black" />
      {scanCameraError ? (
        <p className="mt-3 text-sm text-danger-600" role="alert">
          {scanCameraError}
        </p>
      ) : null}
    </Modal>
  )
}

export function KidModePage() {
  const [pairingCode, setPairingCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [bootLoading, setBootLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<ChildDeviceState | null>(null)
  const [channels, setChannels] = useState<ChildAllowedChannel[]>([])
  const [channelVideos, setChannelVideos] = useState<ChannelVideoItem[]>([])
  const [channelLoading, setChannelLoading] = useState(false)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [videoSearch, setVideoSearch] = useState('')
  const [globalSearchInput, setGlobalSearchInput] = useState('')
  const [kidSurface, setKidSurface] = useState<'watch' | 'parent'>('watch')
  const [kidWatchTab, setKidWatchTab] = useState<'channels' | 'playlist'>('channels')
  /** כל לחיצה על ערוץ (גם על אותו ערוץ) — כדי ש־useEffect יטען מחדש גם כש־activeChannelId לא משתנה */
  const [channelPickNonce, setChannelPickNonce] = useState(0)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [parentModeUnlocked, setParentModeUnlocked] = useState(false)
  const [parentModePinOpen, setParentModePinOpen] = useState(false)
  const [parentModePinInput, setParentModePinInput] = useState('')
  const [parentModePinError, setParentModePinError] = useState<string | null>(null)
  const [pendingParentAction, setPendingParentAction] = useState<'home' | 'channels' | null>(null)
  const [parentBootstrapBusy, setParentBootstrapBusy] = useState(false)
  const [showManualPairing, setShowManualPairing] = useState(false)
  const [forgotPairingOpen, setForgotPairingOpen] = useState(false)
  const [forgotParentEmail, setForgotParentEmail] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotInfo, setForgotInfo] = useState<string | null>(null)
  const [qrScanOpen, setQrScanOpen] = useState(false)
  const [scanCameraError, setScanCameraError] = useState<string | null>(null)
  const qrScannerRef = useRef<Html5Qrcode | null>(null)
  const qrDecodeLockRef = useRef(false)
  const channelVideosRequestRef = useRef(0)
  const [videoSearchFocused, setVideoSearchFocused] = useState(false)
  const [globalSearchPinOpen, setGlobalSearchPinOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string | null>(null)
  const [globalSearchResults, setGlobalSearchResults] = useState<YouTubeVideoResult[]>([])
  const [globalSearchContinuation, setGlobalSearchContinuation] = useState<string | null>(null)
  const [globalSearchHasMore, setGlobalSearchHasMore] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchLoadingMore, setGlobalSearchLoadingMore] = useState(false)
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null)
  const pendingGlobalSearchQueryRef = useRef<string | null>(null)
  const [clockTick, setClockTick] = useState(0)
  const parentTabLongPressRef = useRef<number | null>(null)
  const parentSurfaceHintLongPressRef = useRef<number | null>(null)
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  useEffect(() => {
    lockManagementAppShell()
    setKidSurface('watch')
    setKidWatchTab('channels')
  }, [])

  const clearParentTabLongPress = useCallback(() => {
    if (parentTabLongPressRef.current != null) {
      window.clearTimeout(parentTabLongPressRef.current)
      parentTabLongPressRef.current = null
    }
  }, [])

  const clearParentSurfaceHintLongPress = useCallback(() => {
    if (parentSurfaceHintLongPressRef.current != null) {
      window.clearTimeout(parentSurfaceHintLongPressRef.current)
      parentSurfaceHintLongPressRef.current = null
    }
  }, [])

  /** נקרא פעם אחת — לזיהוי סריקת QR לפני הסרת הפרמטר מהכתובת */
  const [pendingUrlPairCode] = useState(() => {
    try {
      return parsePairingCodeFromLocationSearch(window.location.search, window.location.hash)
    } catch {
      return null
    }
  })

  const filteredVideos = useMemo(
    () => filterVideosByTitle(channelVideos, videoSearch),
    [channelVideos, videoSearch]
  )

  const verifyKidGlobalSearchPin = useCallback(
    async (pin: string) => {
      const token = accessToken ?? getSavedChildAccessToken()
      if (!token) {
        return { ok: false, errorMessage: 'המכשיר לא מחובר' } as const
      }
      const pinForServer = pin.replace(/\s+/g, '').trim()
      if (pinForServer.length < 4) {
        return { ok: false, errorMessage: 'קוד שגוי' } as const
      }
      const { data, error } = await supabase.rpc('local_parent_bootstrap', {
        p_access_token: token,
        p_pin: pinForServer,
      })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row?.device_id) {
        return { ok: false, errorMessage: 'קוד שגוי' } as const
      }
      writeLocalParentSession({
        deviceId: String(row.device_id),
        ownerUserId: String(row.owner_user_id),
        accessToken: token,
        pin: pinForServer,
      })
      return { ok: true as const }
    },
    [accessToken]
  )

  const clearGlobalSearch = useCallback(() => {
    pendingGlobalSearchQueryRef.current = null
    setGlobalSearchInput('')
    setGlobalSearchQuery(null)
    setGlobalSearchResults([])
    setGlobalSearchContinuation(null)
    setGlobalSearchHasMore(false)
    setGlobalSearchError(null)
    setGlobalSearchLoading(false)
    setGlobalSearchLoadingMore(false)
  }, [])

  const runGlobalYoutubeSearch = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return
    setGlobalSearchLoading(true)
    setGlobalSearchLoadingMore(false)
    setGlobalSearchError(null)
    setGlobalSearchQuery(q)
    setGlobalSearchResults([])
    setGlobalSearchContinuation(null)
    setGlobalSearchHasMore(false)
    const { data, error, continuation, hasMore } = await searchYouTubeVideos(q)
    setGlobalSearchLoading(false)
    if (error) {
      setGlobalSearchError(error.message)
      return
    }
    setGlobalSearchResults(data ?? [])
    setGlobalSearchContinuation(continuation)
    setGlobalSearchHasMore(hasMore)
  }, [])

  const loadMoreGlobalYoutubeSearch = useCallback(async () => {
    const q = globalSearchQuery?.trim()
    if (!q || !globalSearchContinuation || globalSearchLoadingMore) return
    setGlobalSearchLoadingMore(true)
    setGlobalSearchError(null)
    const { data, error, continuation, hasMore } = await searchYouTubeVideos(q, {
      continuation: globalSearchContinuation,
    })
    setGlobalSearchLoadingMore(false)
    if (error) {
      setGlobalSearchError(error.message)
      return
    }
    setGlobalSearchResults((prev) => {
      const seen = new Set(prev.map((v) => v.videoId))
      const next = (data ?? []).filter((v) => !seen.has(v.videoId))
      return [...prev, ...next]
    })
    setGlobalSearchContinuation(continuation)
    setGlobalSearchHasMore(hasMore)
  }, [globalSearchQuery, globalSearchContinuation, globalSearchLoadingMore])

  const handleGlobalSearchRequest = useCallback((query: string) => {
    const q = query.trim()
    if (!q) return
    setGlobalSearchInput(q)
    pendingGlobalSearchQueryRef.current = q
    setGlobalSearchPinOpen(true)
  }, [])

  const globalSearchSectionProps = useMemo(
    () => ({
      inputValue: globalSearchInput,
      onInputChange: setGlobalSearchInput,
      onSubmit: handleGlobalSearchRequest,
      query: globalSearchQuery,
      loading: globalSearchLoading,
      error: globalSearchError,
      results: globalSearchResults,
      hasMore: globalSearchHasMore,
      loadingMore: globalSearchLoadingMore,
      onLoadMore: loadMoreGlobalYoutubeSearch,
      onClear: clearGlobalSearch,
    }),
    [
      globalSearchInput,
      handleGlobalSearchRequest,
      globalSearchQuery,
      globalSearchLoading,
      globalSearchError,
      globalSearchResults,
      globalSearchHasMore,
      globalSearchLoadingMore,
      loadMoreGlobalYoutubeSearch,
      clearGlobalSearch,
    ]
  )

  const handleGlobalSearchPinVerified = useCallback(
    (_pin: string) => {
      const q = pendingGlobalSearchQueryRef.current
      pendingGlobalSearchQueryRef.current = null
      setGlobalSearchPinOpen(false)
      if (q) void runGlobalYoutubeSearch(q)
    },
    [runGlobalYoutubeSearch]
  )

  const handleGlobalSearchPinClose = useCallback(() => {
    pendingGlobalSearchQueryRef.current = null
    setGlobalSearchPinOpen(false)
  }, [])

  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null
    return channelVideos.find((v) => v.videoId === activeVideoId) ?? null
  }, [channelVideos, activeVideoId])

  const handleSelectVideo = useCallback((videoId: string) => {
    setActiveVideoId(videoId)
  }, [])

  const activeChannel = useMemo(
    () => channels.find((c) => c.youtube_channel_id === (activeChannelId ?? '')) ?? null,
    [channels, activeChannelId]
  )

  const activeVideoQueueIndex = useMemo(() => {
    if (!activeVideoId) return -1
    return filteredVideos.findIndex((v) => v.videoId === activeVideoId)
  }, [filteredVideos, activeVideoId])

  const hasNextChannelVideo =
    activeVideoQueueIndex >= 0 && activeVideoQueueIndex < filteredVideos.length - 1

  const handlePlayerNextTrack = useCallback(() => {
    const list = filteredVideos
    const idx = list.findIndex((v) => v.videoId === activeVideoId)
    if (idx < 0 || idx >= list.length - 1) return
    setActiveVideoId(list[idx + 1].videoId)
  }, [filteredVideos, activeVideoId])

  const handlePlayerPreviousTrack = useCallback(() => {
    const list = filteredVideos
    const idx = list.findIndex((v) => v.videoId === activeVideoId)
    if (idx <= 0) return
    setActiveVideoId(list[idx - 1].videoId)
  }, [filteredVideos, activeVideoId])

  const loadChannelVideos = useCallback(async (youtubeChannelId: string) => {
    const rid = ++channelVideosRequestRef.current
    // לא לעשות trim ל-youtube_channel_id לפני RPC:
    // אם הערך ב-DB נשמר עם רווחים/תווים נסתרים, ה-RPC מסנן לפי התאמה מדויקת.
    const yt = youtubeChannelId
    if (!yt || !yt.trim()) {
      return
    }
    setChannelLoading(true)
    setError(null)
    if (!accessToken) {
      if (rid === channelVideosRequestRef.current) setChannelLoading(false)
      return
    }
    const { data, error: cacheError } = await getChildCachedChannelVideos(accessToken, yt)
    if (rid !== channelVideosRequestRef.current) return
    setChannelLoading(false)
    if (cacheError) {
      setError(cacheError.message)
      return
    }
    const next: ChannelVideoItem[] = (data ?? []).map((v) => ({
      videoId: v.youtube_video_id,
      title: v.title,
      thumbnail: v.thumbnail_url ?? '',
      channelTitle: '',
    }))
    if (rid !== channelVideosRequestRef.current) return
    setChannelVideos(next)
  }, [accessToken])

  const loadChildData = useCallback(async (token: string) => {
    const [stateRes, channelsRes] = await Promise.all([getChildDeviceState(token), getChildAllowedChannels(token)])
    if (stateRes.error) throw stateRes.error
    if (!stateRes.data) throw new Error('המכשיר לא נמצא. התחברו מחדש עם קוד צימוד.')

    setDevice(stateRes.data)
    if (channelsRes.error) {
      setChannels([])
      setError(channelsRes.error.message)
      return
    }

    setError(null)
    const list = channelsRes.data ?? []
    setChannels(list)
    // חשוב: לא לעשות trim כאן כדי לא לשבור התאמה מדויקת מול RPC.
    const availableIds = new Set(list.map((c) => c.youtube_channel_id))

    if (list.length === 0) {
      setActiveChannelId(null)
      setChannelVideos([])
      return
    }

    // אל תשתמשו ב-activeChannelId מהסגירה — בקשות polling ישנות יכולות לסיים אחרי בחירת ערוץ
    // ולדרוס את הבחירה; תמיד לעגנו ל־prev המעודכן מול הרשימה החדשה מהשרת.
    setActiveChannelId((prev) => {
      const p = prev ?? ''
      if (p && availableIds.has(p)) return p
      return list[0]?.youtube_channel_id ?? null
    })
  }, [])

  const loadChildDataRef = useRef(loadChildData)
  loadChildDataRef.current = loadChildData
  const bootOnceRef = useRef(false)

  useEffect(() => {
    if (bootOnceRef.current) return
    bootOnceRef.current = true

    const stripPairCodeFromUrl = () => {
      const path = window.location.pathname || '/kid'
      window.history.replaceState({}, document.title, path)
    }

    const boot = async () => {
      let urlCode: string | null = null
      try {
        urlCode = parsePairingCodeFromLocationSearch(window.location.search, window.location.hash)
      } catch {
        urlCode = null
      }

      const token = getSavedChildAccessToken()
      if (urlCode && token) {
        // מכשיר ילד יכול להיות מצומד להורה אחד בכל רגע נתון.
        // לא מחליפים צימוד קיים ע"י סריקה חדשה — רק אחרי ניתוק מפורש.
        try {
          setAccessToken(token)
          await loadChildDataRef.current(token)
          setError('המכשיר כבר מחובר להורה. כדי לחבר להורה אחר, נתקו קודם את המכשיר במסך זה ואז סרקו שוב.')
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (message.includes('המכשיר לא נמצא')) {
            clearChildAccessToken()
            setAccessToken(null)
            setError('נמצא קוד חדש, אבל החיבור הישן לא תקין. בצעו צימוד מחדש.')
          } else {
            setError(e instanceof Error ? e.message : 'טעינת מצב ילד נכשלה')
          }
        } finally {
          stripPairCodeFromUrl()
          setBootLoading(false)
        }
        return
      }

      if (urlCode) {
        setAccessToken(null)
        setDevice(null)
        setChannels([])
        setError(null)
        try {
          const { accessToken: newToken, error: pairError } = await pairChildDevice(urlCode)
          if (pairError || !newToken) throw pairError ?? new Error('צימוד נכשל')
          saveChildAccessToken(newToken)
          setAppModeKid()
          setAccessToken(newToken)
          await loadChildDataRef.current(newToken)
          stripPairCodeFromUrl()
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'צימוד נכשל'
          setError(msg)
          stripPairCodeFromUrl()
        } finally {
          setBootLoading(false)
        }
        return
      }

      if (!token) {
        setBootLoading(false)
        return
      }
      try {
        setAccessToken(token)
        await loadChildDataRef.current(token)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (message.includes('המכשיר לא נמצא')) {
          clearChildAccessToken()
          setAccessToken(null)
        }
        setError(e instanceof Error ? e.message : 'טעינת מצב ילד נכשלה')
      } finally {
        setBootLoading(false)
      }
    }
    void boot()
  }, [])

  const pollChildDeviceState = useCallback(async (token: string) => {
    const [hbRes, stateRes] = await Promise.all([childHeartbeat(token), getChildDeviceState(token)])
    if (stateRes.error) throw stateRes.error
    if (stateRes.data) {
      setDevice(stateRes.data)
      return
    }
    if (hbRes.data) {
      setDevice((prev) => (prev ? { ...prev, ...hbRes.data, is_online: true } : prev))
    }
  }, [])

  useEffect(() => {
    if (!accessToken) return
    const pollState = () => {
      void pollChildDeviceState(accessToken).catch((e) => {
        setError(e instanceof Error ? e.message : 'עדכון מצב נכשל')
      })
    }
    pollState()
    const stateId = window.setInterval(pollState, 3_000)
    const channelsId = window.setInterval(() => {
      void loadChildData(accessToken).catch((e) => {
        setError(e instanceof Error ? e.message : 'עדכון ערוצים נכשל')
      })
    }, 30_000)
    return () => {
      window.clearInterval(stateId)
      window.clearInterval(channelsId)
    }
  }, [accessToken, pollChildDeviceState, loadChildData])

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const screenBreak = useMemo(() => evaluateKidScreenBreak(device), [device, clockTick])
  const screenLocked = screenBreak != null

  const handleWatchSecondsToday = useCallback((seconds: number) => {
    setDevice((prev) => (prev ? { ...prev, watch_seconds_today: seconds } : prev))
  }, [])

  const handleLocalWatchSecond = useCallback(() => {
    setDevice((prev) =>
      prev ? { ...prev, watch_seconds_today: prev.watch_seconds_today + 1 } : prev
    )
  }, [])

  useKidWatchTimeReporter(accessToken, screenLocked, handleWatchSecondsToday, handleLocalWatchSecond)

  useEffect(() => {
    const yt = activeChannelId
    if (!yt || !yt.trim()) return
    void loadChannelVideos(yt)
  }, [activeChannelId, channelPickNonce, loadChannelVideos])

  useEffect(() => {
    if (channelVideos.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) => {
      if (prev && channelVideos.some((v) => v.videoId === prev)) return prev
      return channelVideos[0]?.videoId ?? null
    })
  }, [channelVideos, activeChannelId, channelPickNonce])

  useEffect(() => {
    if (videoSearchFocused) return
    if (filteredVideos.length === 0) {
      if (videoSearch.trim()) setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) => {
      if (prev && filteredVideos.some((v) => v.videoId === prev)) return prev
      return filteredVideos[0]?.videoId ?? null
    })
  }, [videoSearch, filteredVideos, videoSearchFocused])

  useEffect(() => {
    if (!accessToken) return
    const onBeforeUnload = () => {
      void childMarkOffline(accessToken)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [accessToken])

  const pairByCodeInitial = useCallback(
    async (codeRaw: string) => {
      const code = codeRaw.trim()
      if (!code) {
        setError('יש להזין קוד צימוד')
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        const { accessToken: token, error: pairError } = await pairChildDevice(code)
        if (pairError || !token) throw pairError ?? new Error('צימוד נכשל')
        saveChildAccessToken(token)
        setAppModeKid()
        setAccessToken(token)
        await loadChildData(token)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'צימוד נכשל')
      } finally {
        setSubmitting(false)
      }
    },
    [loadChildData]
  )

  const handlePair = () => void pairByCodeInitial(pairingCode)

  const sendForgotPairingReminder = () => {
    void (async () => {
      const trimmed = forgotParentEmail.trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setForgotInfo(null)
        setError('נא להזין אימייל הורה תקין')
        return
      }
      setForgotBusy(true)
      setForgotInfo(null)
      setError(null)
      try {
        const result = await requestPairingReminderEmail(trimmed)
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (result.ok && 'skipped' in result && result.skipped) {
          setForgotInfo('כבר נשלח לאחרונה — המתינו כמה דקות לפני בקשה נוספת.')
          return
        }
        if (result.ok && 'sent' in result && result.sent) {
          if (result.deviceCount === 0) {
            setForgotInfo('נשלח מייל. אם אין כרגע קוד צימוד פעיל, צרו פרופיל חדש בלוח ההורה.')
          } else {
            setForgotInfo(`נשלח מייל עם ${result.deviceCount} קוד/י צימוד פעיל/ים. בדקו את תיבת הדואר.`)
          }
          return
        }
        if (result.ok && 'sent' in result && !result.sent) {
          setForgotInfo('אם האימייל רשום אצלנו, בדקו את המייל. אחרת ודאו שהכתובת נכונה.')
        }
      } finally {
        setForgotBusy(false)
      }
    })()
  }

  const pairByCodeInitialRef = useRef(pairByCodeInitial)
  pairByCodeInitialRef.current = pairByCodeInitial

  useEffect(() => {
    if (!qrScanOpen) {
      qrDecodeLockRef.current = false
      return
    }
    qrDecodeLockRef.current = false
    setScanCameraError(null)

    let cancelled = false

    const stopScanner = async (scanner: Html5Qrcode) => {
      try {
        await scanner.stop()
        await scanner.clear()
      } catch {
        /* כבר נעצר או נוקה */
      }
      if (qrScannerRef.current === scanner) qrScannerRef.current = null
    }

    void (async () => {
      const { Html5Qrcode } = await import('html5-qrcode')
      await new Promise<void>((r) => queueMicrotask(r))
      if (cancelled) return

      if (!document.getElementById('kid-mode-html5-qrcode-reader')) {
        setScanCameraError('לא ניתן להפעיל את תצוגת הסריקה. נסו שוב.')
        return
      }

      const scanner = new Html5Qrcode('kid-mode-html5-qrcode-reader', false)
      qrScannerRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: (w, h) => {
              const edge = Math.min(250, Math.floor(Math.min(w, h) * 0.72))
              return { width: edge, height: edge }
            },
          },
          async (decodedText) => {
            if (qrDecodeLockRef.current || cancelled) return
            const pairing = parsePairingCodeFromScan(decodedText)
            if (!pairing) return
            qrDecodeLockRef.current = true
            await stopScanner(scanner)
            setQrScanOpen(false)
            await pairByCodeInitialRef.current(pairing)
          },
          () => {}
        )
      } catch (e) {
        if (!cancelled) {
          setScanCameraError(
            e instanceof Error
              ? e.message
              : 'המצלמה לא נפתחה. בדקו הרשאות בדפדפן או השתמשו בהזנת קוד ידנית.'
          )
        }
      }
    })()

    return () => {
      cancelled = true
      const s = qrScannerRef.current
      qrScannerRef.current = null
      if (s) void stopScanner(s)
    }
  }, [qrScanOpen])

  const handleDisconnect = async () => {
    if (!accessToken) return
    setDisconnecting(true)
    try {
      await childMarkOffline(accessToken)
    } finally {
      clearChildAccessToken()
      setAccessToken(null)
      setDevice(null)
      setChannels([])
      setChannelVideos([])
      setActiveChannelId(null)
      setActiveVideoId(null)
      setPairingCode('')
      setShowManualPairing(false)
      setPinInput('')
      setPinError(null)
      setPinModalOpen(false)
      lockParentMode()
      setParentModePinOpen(false)
      setParentModePinInput('')
      setParentModePinError(null)
      setPendingParentAction(null)
      setDisconnecting(false)
      setKidSurface('watch')
    }
  }

  const confirmPinAndDisconnect = async () => {
    const pinForServer = pinInput.replace(/\s+/g, '').trim()
    if (!accessToken) {
      setPinError('המכשיר לא מחובר. נסו שוב.')
      return
    }
    if (pinForServer.length < 4) {
      setPinError('PIN שגוי')
      return
    }

    setPinError(null)
    const { data, error } = await supabase.rpc('local_parent_bootstrap', {
      p_access_token: accessToken,
      p_pin: pinForServer,
    })
    const row = Array.isArray(data) ? data[0] : null
    if (error || !row?.device_id) {
      setPinError('PIN שגוי')
      return
    }
    await handleDisconnect()
  }

  const runParentAction = (action: 'home' | 'channels') => {
    setParentEntryIntent()
    const target = action === 'home' ? '/dashboard' : '/channels'
    if (isAuthenticated) {
      navigate(target)
      return
    }
    if (getSavedChildAccessToken() && isLocalParentSessionValid()) {
      navigate(target)
      return
    }
    navigate(`/auth?next=${encodeURIComponent(target)}`)
  }

  const lockParentMode = useCallback(() => {
    setParentModeUnlocked(false)
    setPendingParentAction(null)
    try {
      window.sessionStorage.removeItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const unlockParentMode = useCallback(() => {
    setParentModeUnlocked(true)
    const unlockUntil = Date.now() + PARENT_MODE_UNLOCK_MS
    try {
      window.sessionStorage.setItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY, String(unlockUntil))
    } catch {
      /* ignore */
    }
  }, [])

  const requestParentAction = async (action: 'home' | 'channels') => {
    if (isLocalParentSessionValid() && getSavedChildAccessToken()) {
      runParentAction(action)
      return
    }
    if (parentModeUnlocked) {
      runParentAction(action)
      return
    }
    setPendingParentAction(action)
    setParentModePinInput('')
    setParentModePinError(null)
    setParentModePinOpen(true)
  }

  const confirmParentModePin = async () => {
    const pinForServer = parentModePinInput.replace(/\s+/g, '').trim()
    const savedToken = getSavedChildAccessToken()
    if (pinForServer.length < 4) {
      setParentModePinError('PIN שגוי')
      return
    }
    if (!savedToken) {
      setParentModePinError('המכשיר לא מחובר. נסו שוב.')
      return
    }

    setParentBootstrapBusy(true)
    try {
      const { data, error } = await supabase.rpc('local_parent_bootstrap', {
        p_access_token: savedToken,
        p_pin: pinForServer,
      })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row?.device_id) {
        setParentModePinError('PIN שגוי')
        return
      }
      writeLocalParentSession({
        until: Date.now() + LOCAL_PARENT_SESSION_MS,
        deviceId: String(row.device_id),
        ownerUserId: String(row.owner_user_id),
        accessToken: savedToken,
        pin: pinForServer,
      })
    } finally {
      setParentBootstrapBusy(false)
    }

    unlockParentMode()
    setParentModePinOpen(false)
    setParentModePinInput('')
    setParentModePinError(null)
    const action = pendingParentAction
    setPendingParentAction(null)
    if (action) runParentAction(action)
  }

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      const unlockUntil = raw ? Number(raw) : 0
      if (unlockUntil > Date.now()) {
        setParentModeUnlocked(true)
      } else {
        window.sessionStorage.removeItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!parentModeUnlocked) return
    const raw = (() => {
      try {
        return window.sessionStorage.getItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      } catch {
        return null
      }
    })()
    const unlockUntil = raw ? Number(raw) : Date.now() + PARENT_MODE_UNLOCK_MS
    const remainingMs = Math.max(500, unlockUntil - Date.now())
    const timeoutId = window.setTimeout(() => {
      lockParentMode()
    }, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [parentModeUnlocked, lockParentMode])

  if (bootLoading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <LoadingSpinner className="h-10 w-10 border-brand-500 border-t-transparent" />
        <p className="text-sm text-slate-600 dark:text-zinc-400">
          {pendingUrlPairCode ? 'מחברים לפרופיל אחרי הסריקה…' : 'טוען…'}
        </p>
      </div>
    )
  }

  if (!accessToken || !device) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pb-10 pt-8">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-zinc-50">{KID_APP_DISPLAY_NAME}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
            <strong className="text-slate-800 dark:text-zinc-200">ההתקנה העיקרית כאן:</strong> התחברו כהורה באותו דפדפן (אימייל וסיסמה), צרו פרופיל בלוח הבקרה, והזינו למטה את <strong>קוד הצימוד בן 6 הספרות</strong> — החיבור נשמר במכשיר ולא יבקשו שוב התחברות הורה.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
            קוד ה־QR בלוח ההורה מיועד ל<strong className="font-semibold text-slate-700 dark:text-zinc-300">טלפון נוסף</strong> של ההורה (צפייה / ניטור) — לא חובה להגדרה על המכשיר הזה.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">
            אם נפתח מסך התחברות (אימייל) במקום צימוד — סגרו אותו ופתחו שוב את הקישור מה־QR, או הזינו את קוד ה־6 ספרות ידנית כאן.
          </p>
        </div>

        {!showManualPairing ? (
          <section className="rounded-2xl border border-slate-200 bg-brand-50/80 p-5 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80">
            <p className="text-sm font-medium text-slate-800 dark:text-zinc-200">סריקת QR (אופציונלי)</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
              אם יש לכם קישור עם קוד מההורה — אפשר לסרוק. אחרת מומלץ להתחבר כהורה כאן ולהזין קוד ידנית.
            </p>
            <Button
              type="button"
              className="mt-4 w-full"
              onClick={() => setQrScanOpen(true)}
            >
              <Camera className="h-4 w-4" aria-hidden />
              סריקה במצלמה
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => {
                setShowManualPairing(true)
                setForgotPairingOpen(false)
                setForgotParentEmail('')
                setForgotInfo(null)
                setError(null)
              }}
            >
              הזנת קוד ידנית (גיבוי)
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => void requestParentAction('home')}
            >
              {isAuthenticated ? 'מעבר ללוח ההורה (אותו מכשיר)' : 'התחברות הורה — הגדרה על המכשיר הזה'}
            </Button>
            {error ? <p className="mt-3 text-sm text-danger-600">{error}</p> : null}
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-zinc-300">קוד צימוד (6 ספרות)</label>
            <Input
              inputMode="numeric"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="לדוגמה: 123456"
              className="text-center text-lg tracking-[0.2em]"
              onKeyDown={(e) => e.key === 'Enter' && void handlePair()}
              autoFocus
            />
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                className="text-xs font-normal text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-zinc-500 dark:hover:text-zinc-400"
                onClick={() => {
                  setForgotPairingOpen((o) => !o)
                  setForgotInfo(null)
                  setError(null)
                }}
              >
                שכחתי קוד?
              </button>
            </div>
            {forgotPairingOpen ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-zinc-600 dark:bg-zinc-800/50">
                <p className="mb-2 text-xs text-slate-600 dark:text-zinc-400">
                  הזינו את אימייל ההורה הרשום — נשלח מייל עם קודי צימוד פעילים (אם קיימים).
                </p>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-zinc-400">אימייל ההורה</label>
                <Input
                  dir="ltr"
                  type="email"
                  autoComplete="email"
                  value={forgotParentEmail}
                  onChange={(e) => setForgotParentEmail(e.target.value)}
                  placeholder="parent@example.com"
                  className="text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && sendForgotPairingReminder()}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3 w-full"
                  disabled={forgotBusy}
                  onClick={sendForgotPairingReminder}
                >
                  {forgotBusy ? <LoadingSpinner className="h-5 w-5 border-2 border-slate-600 border-t-transparent" /> : null}
                  {forgotBusy ? 'שולח…' : 'שלחו לי את הקודים במייל'}
                </Button>
              </div>
            ) : null}
            {forgotInfo ? (
              <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400" role="status">
                {forgotInfo}
              </p>
            ) : null}
            {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
            <Button className="mt-4 w-full" disabled={submitting} onClick={() => void handlePair()}>
              {submitting ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
              {submitting ? 'מתחבר...' : 'חבר פרופיל'}
            </Button>
            <button
              type="button"
              className="mt-3 w-full text-center text-xs text-slate-500 underline-offset-2 hover:underline dark:text-zinc-500"
              onClick={() => {
                setShowManualPairing(false)
                setPairingCode('')
                setForgotPairingOpen(false)
                setForgotParentEmail('')
                setForgotInfo(null)
                setError(null)
              }}
            >
              חזרה להסבר על הסריקה
            </button>
          </section>
        )}
        <KidQrScanModal
          open={qrScanOpen}
          onClose={() => setQrScanOpen(false)}
          scanCameraError={scanCameraError}
        />
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 via-white to-violet-50 text-yt-text dark:from-slate-950 dark:via-yt-bg dark:to-indigo-950/40">
      <header className="sticky top-0 z-30 border-b border-sky-200/70 bg-gradient-to-r from-sky-100/95 via-indigo-50/95 to-violet-100/95 pb-[env(safe-area-inset-top)] backdrop-blur-md dark:border-indigo-900/50 dark:from-indigo-950/90 dark:via-sky-950/80 dark:to-violet-950/90">
        <div className="mx-auto grid max-w-[1920px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 px-2 py-2 sm:gap-x-4 sm:px-3 sm:py-2">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-bold text-yt-text">
              {kidSurface === 'parent'
                ? 'אזור הורים'
                : kidWatchTab === 'playlist'
                  ? 'הפלייליסטים שלי'
                  : device.device_name}
            </p>
            <p className="text-[11px] text-yt-textMuted">{KID_APP_DISPLAY_NAME}</p>
          </div>
          <SafeTubeBrandMark to="/kid" className="justify-self-center px-0.5" />
          <div className="flex min-w-0 items-center justify-end gap-2 ps-2 pe-0.5 sm:gap-3 sm:pe-1">
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-yt-border bg-yt-input p-0.5"
              role="tablist"
              aria-label="מצב מסך"
            >
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'watch' && kidWatchTab === 'channels'}
              onClick={() => {
                setKidSurface('watch')
                setKidWatchTab('channels')
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                kidSurface === 'watch' && kidWatchTab === 'channels'
                  ? 'bg-sky-500 text-white shadow-sm dark:bg-sky-600'
                  : 'text-yt-textMuted hover:text-yt-text'
              }`}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              צפייה
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'watch' && kidWatchTab === 'playlist'}
              onClick={() => {
                setKidSurface('watch')
                setKidWatchTab('playlist')
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                kidSurface === 'watch' && kidWatchTab === 'playlist'
                  ? 'bg-violet-500 text-white shadow-sm dark:bg-violet-600'
                  : 'text-yt-textMuted hover:text-yt-text'
              }`}
            >
              <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
              פלייליסטים
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'parent'}
              aria-label="הורים — לחיצה ארוכה לפתיחה"
              title={`החזיקו לחוץ כדי לפתוח (${PARENT_TAB_LONG_PRESS_MS / 1000} שנ׳)`}
              onPointerDown={() => {
                clearParentTabLongPress()
                parentTabLongPressRef.current = window.setTimeout(() => {
                  parentTabLongPressRef.current = null
                  setKidSurface('parent')
                }, PARENT_TAB_LONG_PRESS_MS)
              }}
              onPointerUp={clearParentTabLongPress}
              onPointerLeave={clearParentTabLongPress}
              onPointerCancel={clearParentTabLongPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => e.preventDefault()}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition touch-manipulation select-none ${
                kidSurface === 'parent'
                  ? 'bg-yt-surfaceHover text-yt-text shadow-sm'
                  : 'text-yt-textMuted opacity-90 hover:text-yt-text'
              }`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              הורים
            </button>
            </div>
            <ThemeToggle compact className="shrink-0" />
          </div>
        </div>
      </header>

      {kidSurface === 'watch' && kidWatchTab === 'channels' && channels.length > 0 ? (
        <div className="border-b border-yt-border bg-yt-bg px-3 py-2 lg:hidden">
          <KidGlobalSearchSection
            id="kid-global-youtube-search-mobile"
            compact
            {...globalSearchSectionProps}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mx-auto max-w-[1920px] px-3 py-2 text-sm text-danger-600 sm:px-4">{error}</p>
      ) : null}

      {kidSurface === 'parent' ? (
        <main className="mx-auto w-full max-w-lg px-2 py-3 sm:px-3">
          <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
            <h2 className="text-sm font-bold text-slate-800 dark:text-zinc-100">ניהול הורה במכשיר הזה</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
              אם כבר התחברתם כהורה באותו דפדפן — עוברים ללוח בלי להקליד שוב אימייל. מכשיר הילד נשאר מצומד ב־localStorage עד
              ניתוק מפורש.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-zinc-500">
              {parentModeUnlocked ? 'מצב הורה (PIN) נפתח ל־10 דקות.' : 'מעבר ללוח/ערוצים דורש PIN הורה או סשן שכבר אומת.'}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                variant="secondary"
                className="w-full min-[400px]:w-auto"
                onClick={() => void requestParentAction('home')}
              >
                {isAuthenticated
                  ? 'לוח בקרה'
                  : isLocalParentSessionValid() && getSavedChildAccessToken()
                    ? 'לוח בקרה'
                    : 'התחברות — לוח בקרה'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full min-[400px]:w-auto"
                onClick={() => void requestParentAction('channels')}
              >
                {isAuthenticated
                  ? 'ניהול ערוצים'
                  : isLocalParentSessionValid() && getSavedChildAccessToken()
                    ? 'ניהול ערוצים'
                    : 'התחברות — ערוצים'}
              </Button>
              {parentModeUnlocked ? (
                <Button type="button" variant="secondary" onClick={lockParentMode} className="w-full min-[400px]:w-auto">
                  נעל מצב הורה
                </Button>
              ) : null}
            </div>
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-zinc-800">
              <p className="text-xs text-slate-600 dark:text-zinc-400">נתק את מכשיר הילד מההורה (נדרש PIN)</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full border-danger-200 text-danger-700 hover:bg-danger-50 dark:border-danger-800 dark:text-danger-300 dark:hover:bg-danger-950/40 sm:w-auto"
                onClick={() => setPinModalOpen(true)}
              >
                נתק מכשיר
              </Button>
            </div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">
              לחזרה ללוח ההורה: החזיקו לחוץ על לשונית &quot;הורים&quot; למעלה והזינו PIN.
            </p>
          </section>
        </main>
      ) : device.is_blocked ? (
        <section className="mx-auto max-w-lg px-4 py-10">
          <div className="rounded-2xl border border-danger-700/50 bg-gradient-to-b from-danger-900/30 to-danger-950/80 p-8 text-center text-danger-100 shadow-inner">
            <ShieldAlert className="mx-auto mb-3 h-12 w-12 opacity-90" aria-hidden />
            <h2 className="text-xl font-black tracking-tight">{KID_APP_DISPLAY_NAME}</h2>
            <p className="mt-3 text-sm leading-relaxed opacity-95">
              הצפייה חסומה כרגע מההורה. בקשו לפתוח — או עברו ללשונית <strong>הורים</strong> לנתק או לנהל.
            </p>
          </div>
        </section>
      ) : (
        <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-0 lg:grid lg:min-h-0 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:items-start">
          {kidWatchTab === 'playlist' ? (
            <div className="min-w-0 flex-1 lg:col-span-2">
              {accessToken ? (
                <KidPlaylistView childAccessToken={accessToken} forcePaused={screenLocked} />
              ) : null}
            </div>
          ) : channels.length === 0 ? (
            <div className="px-3 py-4 sm:px-4 lg:col-span-2">
              <div className="rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-5 text-sm leading-relaxed text-amber-950 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-100">
                <p className="font-semibold">אין ערוצים שמקושרים לפרופיל הזה</p>
                <p className="mt-2 text-amber-900/95 dark:text-amber-200/90">
                  בלשונית <strong className="font-bold">הורים</strong> — ניהול ערוצים, ובחרו את הפרופיל &quot;{device.device_name}
                  &quot;.
                </p>
                <p className="mt-2 text-[11px] text-amber-900/90 dark:text-amber-200/85">
                  לפתיחת אזור ההורים: החזיקו לחוץ על כפתור &quot;הורים&quot; בשורת הכותרת למעלה.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  title={`החזיקו לחוץ (${PARENT_TAB_LONG_PRESS_MS / 1000} שנ׳)`}
                  onPointerDown={() => {
                    clearParentSurfaceHintLongPress()
                    parentSurfaceHintLongPressRef.current = window.setTimeout(() => {
                      parentSurfaceHintLongPressRef.current = null
                      setKidSurface('parent')
                    }, PARENT_TAB_LONG_PRESS_MS)
                  }}
                  onPointerUp={clearParentSurfaceHintLongPress}
                  onPointerLeave={clearParentSurfaceHintLongPress}
                  onPointerCancel={clearParentSurfaceHintLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={(e) => e.preventDefault()}
                >
                  לשונית הורים (לחיצה ארוכה)
                </Button>
              </div>
            </div>
          ) : (
            <>
              <aside className="hidden min-h-0 border-s border-black/[0.06] bg-white dark:border-zinc-800 dark:bg-zinc-950/80 lg:sticky lg:top-[52px] lg:block lg:max-h-[calc(100dvh-3rem)] lg:shrink-0 lg:overflow-y-auto lg:pb-6">
                <div className="border-b border-black/[0.06] p-2 dark:border-zinc-800">
                  <KidGlobalSearchSection
                    id="kid-global-youtube-search-desktop"
                    compact
                    {...globalSearchSectionProps}
                  />
                </div>
                <p className="border-b border-black/[0.06] bg-white/80 px-3 py-2.5 text-xs font-bold text-slate-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-400">
                  הערוצים שלי
                </p>
                <div className="flex flex-col gap-0.5 p-2">
                  {channels.map((channel) => {
                    const yt = channel.youtube_channel_id
                    const selected = yt === (activeChannelId ?? '')
                    return (
                      <button
                        key={channel.channel_id}
                        type="button"
                        onClick={() => {
                          setVideoSearch('')
                          clearGlobalSearch()
                          setActiveChannelId(yt)
                          setChannelPickNonce((n) => n + 1)
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl p-2 text-right transition ${
                          selected
                            ? 'bg-slate-200/80 dark:bg-zinc-800'
                            : 'hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                        }`}
                      >
                        {channel.channel_thumbnail ? (
                          <img
                            src={channel.channel_thumbnail}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-zinc-800">
                            <Smartphone className="h-4 w-4" />
                          </div>
                        )}
                        <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug text-slate-800 dark:text-zinc-200">
                          {channel.channel_name}
                        </span>
                        {channel.category ? (
                          <span className="shrink-0 text-[10px] text-brand-600 dark:text-brand-400">{channel.category}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </aside>

              <div className="min-w-0 flex-1 bg-gradient-to-b from-sky-50/80 via-white to-violet-50/60 dark:from-slate-950 dark:via-[#0f0f0f] dark:to-indigo-950/20 lg:pt-0">
                <div className="border-b border-black/[0.06] bg-white px-1.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-950/90 lg:hidden">
                  <p className="mb-1 px-0.5 text-[11px] font-bold text-slate-500">ערוץ</p>
                  <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5 pt-0.5">
                    {channels.map((channel) => {
                      const yt = channel.youtube_channel_id
                      const selected = yt === (activeChannelId ?? '')
                      return (
                        <button
                          key={channel.channel_id}
                          type="button"
                          onClick={() => {
                            setVideoSearch('')
                            clearGlobalSearch()
                            setActiveChannelId(yt)
                            setChannelPickNonce((n) => n + 1)
                          }}
                          className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl px-2 py-1.5 ${
                            selected ? 'bg-slate-200 dark:bg-zinc-800' : 'bg-slate-100/80 dark:bg-zinc-900/80'
                          }`}
                        >
                          {channel.channel_thumbnail ? (
                            <img
                              src={channel.channel_thumbnail}
                              alt=""
                              className="h-12 w-12 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 dark:bg-zinc-800">
                              <Smartphone className="h-5 w-5 text-slate-500" />
                            </div>
                          )}
                          <span className="line-clamp-1 max-w-[4.5rem] text-center text-[10px] font-medium text-slate-800 dark:text-zinc-200">
                            {channel.channel_name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="border-b border-zinc-800/80 bg-[#0f0f0f] px-3 py-3 lg:hidden">
                  <ChannelVideoSearchBar
                    id="kid-channel-video-search-mobile"
                    value={videoSearch}
                    onChange={setVideoSearch}
                    onFocusChange={setVideoSearchFocused}
                    totalCount={channelVideos.length}
                    filteredCount={filteredVideos.length}
                    channelLabel={activeChannel?.channel_name ?? null}
                  />
                  
                </div>

                <YoutubeWatchLayout
                  className="mx-auto max-w-[1600px] px-1.5 pb-3 pt-1.5 sm:px-2 sm:pb-4 lg:px-3 lg:pt-2"
                  main={
                    channelLoading ? (
                      <div className="flex aspect-video max-w-5xl items-center justify-center gap-3 rounded-xl bg-black/90 text-zinc-200">
                        <LoadingSpinner className="h-9 w-9 shrink-0 border-2 border-red-500 border-t-transparent" />
                        <span className="text-base font-semibold">טוען…</span>
                      </div>
                    ) : activeVideo ? (
                      <>
                        <div className="relative w-full overflow-hidden rounded-none bg-black lg:rounded-none">
                          <div className="relative pt-[56.25%]">
                            <div className="absolute inset-0 min-h-0">
                              <CleanPlayer
                                videoId={activeVideo.videoId}
                                title={activeVideo.title}
                                channelTitle={activeChannel?.channel_name}
                                posterUrl={activeVideo.thumbnail}
                                onNextTrack={handlePlayerNextTrack}
                                onPreviousTrack={handlePlayerPreviousTrack}
                                hasNextTrack={hasNextChannelVideo}
                                forcePaused={screenLocked}
                                className="h-full w-full"
                              />
                            </div>
                          </div>
                        </div>
                        <YoutubeWatchVideoDetails
                          title={activeVideo.title}
                          channelName={activeChannel?.channel_name ?? null}
                          subtitle="מאושר — SafeTube"
                          actions={
                            accessToken ? (
                              <AddToPlaylistButton
                                mode="kid"
                                userId={null}
                                childAccessToken={accessToken}
                                video={{
                                  youtube_video_id: activeVideo.videoId,
                                  title: activeVideo.title,
                                  thumbnail_url: activeVideo.thumbnail || null,
                                  youtube_channel_id: activeChannelId,
                                  channel_name: activeChannel?.channel_name ?? null,
                                }}
                              />
                            ) : null
                          }
                        />
                      </>
                    ) : channelVideos.length > 0 && videoSearch.trim() ? (
                      <div className="flex min-h-[min(50vh,320px)] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-gradient-to-b from-white to-slate-50/90 px-5 py-10 text-center dark:border-brand-900/50 dark:from-zinc-900/80 dark:to-zinc-950/90">
                        <Search
                          className="h-16 w-16 text-brand-500 dark:text-brand-400"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <p className="max-w-sm text-xl font-bold leading-tight text-slate-800 dark:text-zinc-100">
                          לא מצאנו סרטון עם המילים האלה
                        </p>
                        <p className="max-w-md text-base leading-relaxed text-slate-600 dark:text-zinc-400">
                          נסו שם אחר, או מחקו את החיפוש כדי לראות את כל הסרטונים בערוץ.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-[48px] min-w-[160px] rounded-2xl text-base font-semibold"
                          onClick={() => {
                            setVideoSearch('')
                            clearGlobalSearch()
                          }}
                        >
                          מחק חיפוש
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
                        <Unplug className="h-14 w-14 text-slate-400" strokeWidth={1.75} aria-hidden />
                        <p className="text-base font-medium text-slate-700 dark:text-zinc-300">בחרו ערוץ כדי לטעון סרטונים.</p>
                      </div>
                    )
                  }
                  sidebar={
                    <>
                      <ChannelVideoSearchBar
                        id="kid-channel-video-search"
                        value={videoSearch}
                        onChange={setVideoSearch}
                        onFocusChange={setVideoSearchFocused}
                        totalCount={channelVideos.length}
                        filteredCount={filteredVideos.length}
                        channelLabel={activeChannel?.channel_name ?? null}
                        className="mb-3 hidden lg:block"
                      />
                      
                      <YoutubeSuggestedList title="סרטונים מומלצים">
                        {filteredVideos.length > 0
                          ? filteredVideos.map((video) => {
                              const isCurrent = video.videoId === activeVideoId
                              return (
                                <li key={video.videoId} className="w-full">
                                  <YoutubeVideoCard
                                    layout="row"
                                    title={video.title}
                                    thumbnail={video.thumbnail}
                                    channelName={activeChannel?.channel_name ?? undefined}
                                    active={isCurrent}
                                    playingLabel="מנגן"
                                    onClick={() => handleSelectVideo(video.videoId)}
                                    actionSlot={
                                      accessToken ? (
                                        <AddToPlaylistButton
                                          mode="kid"
                                          userId={null}
                                          childAccessToken={accessToken}
                                          compact
                                          video={{
                                            youtube_video_id: video.videoId,
                                            title: video.title,
                                            thumbnail_url: video.thumbnail || null,
                                            youtube_channel_id: activeChannelId,
                                            channel_name: activeChannel?.channel_name ?? null,
                                          }}
                                        />
                                      ) : null
                                    }
                                  />
                                </li>
                              )
                            })
                          : null}
                      </YoutubeSuggestedList>
                      {!channelLoading && filteredVideos.length === 0 ? (
                        <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300/90 bg-white/40 px-3 py-6 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
                          <p className="text-sm font-semibold leading-snug text-slate-700 dark:text-zinc-300">
                            {videoSearch.trim()
                              ? 'אין סרטונים שמתאימים לחיפוש.'
                              : channelVideos.length === 0
                                ? 'אין עדיין סרטונים בערוץ הזה. בקשו מההורה להוסיף סרטונים.'
                                : 'אין סרטונים.'}
                          </p>
                        </div>
                      ) : null}
                    </>
                  }
                />
              </div>
            </>
          )}
        </div>
      )}

      <Modal
        open={parentModePinOpen}
        onClose={() => {
          setParentModePinOpen(false)
          setParentModePinInput('')
          setParentModePinError(null)
          setPendingParentAction(null)
        }}
        title="פתיחת מצב הורה"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setParentModePinOpen(false)
                setParentModePinInput('')
                setParentModePinError(null)
                setPendingParentAction(null)
              }}
            >
              ביטול
            </Button>
            <Button onClick={() => void confirmParentModePin()} disabled={parentBootstrapBusy}>
              {parentBootstrapBusy ? 'מאמת…' : 'אשר'}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600 dark:text-zinc-400">
          הכניסה לניהול הורה מהמכשיר הזה מוגנת ב-PIN.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={parentModePinInput}
          onChange={(e) => {
            setParentModePinInput(e.target.value)
            if (parentModePinError) setParentModePinError(null)
          }}
          placeholder="PIN הורה"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && !parentBootstrapBusy && void confirmParentModePin()}
        />
        {parentModePinError ? <p className="mt-2 text-sm text-danger-600">{parentModePinError}</p> : null}
      </Modal>

      <Modal
        open={pinModalOpen}
        onClose={() => {
          if (disconnecting) return
          setPinModalOpen(false)
          setPinInput('')
          setPinError(null)
        }}
        title="אישור הורה"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPinModalOpen(false)
                setPinInput('')
                setPinError(null)
              }}
              disabled={disconnecting}
            >
              ביטול
            </Button>
            <Button onClick={() => void confirmPinAndDisconnect()} disabled={disconnecting}>
              {disconnecting ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
              {disconnecting ? 'מנתק...' : 'אשר ונתק'}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600 dark:text-zinc-400">
          הזינו את קוד הניהול שמופעל אצל ההורה (במסך ניהול הערוצים). אם לא הוגדר מיוחד — נסו <strong>1234</strong>.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value)
            if (pinError) setPinError(null)
          }}
          placeholder="למשל: 1234"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void confirmPinAndDisconnect()}
        />
        {pinError ? <p className="mt-2 text-sm text-danger-600">{pinError}</p> : null}
      </Modal>

      {screenBreak ? <KidScreenBreakOverlay reason={screenBreak} /> : null}

      <ParentalPinModal
        open={globalSearchPinOpen}
        onClose={handleGlobalSearchPinClose}
        verifyPin={verifyKidGlobalSearchPin}
        onVerified={handleGlobalSearchPinVerified}
        title="אימות הורה — חיפוש YouTube"
        description="חיפוש בכל YouTube דורש קוד הורה. הזינו PIN כדי להמשיך — אחרת החיפוש יבוטל."
      />
    </div>
  )
}
