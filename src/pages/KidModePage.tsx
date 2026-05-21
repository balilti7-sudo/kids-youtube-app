import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ListMusic, Play, Search, ShieldAlert, Smartphone, Unplug, Users } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { KidPlaylistView } from '../components/kid/KidPlaylistView'
import { PlaylistToggleButton } from '../components/kid/PlaylistToggleButton'
import { useChildPlaylist } from '../hooks/useChildPlaylist'
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
import { parsePairingCodeFromLocationSearch, parsePairingCodeFromScan } from '../lib/pairingCodeFromQr'
import { requestPairingReminderEmail } from '../lib/requestPairingReminderEmail'
import { SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY } from '../lib/safetubeSessionKeys'
import { supabase } from '../lib/supabase'
import { setAppModeKid } from '../lib/appMode'
import { lockManagementAppShell } from '../lib/lockParentApp'
import { setParentEntryIntent } from '../lib/parentEntryIntent'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import type { ChannelVideoItem } from '../lib/youtube'
import { CleanPlayer } from '../components/player/CleanPlayer'
import { SafeTubeBrandMark } from '../components/branding/SafeTubeBrandMark'
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
  const parentTabLongPressRef = useRef<number | null>(null)
  const parentSurfaceHintLongPressRef = useRef<number | null>(null)
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const playlist = useChildPlaylist(accessToken)

  const handlePlaylistToggle = useCallback(
    async (payload: Parameters<typeof playlist.toggle>[0]) => {
      const { error: toggleError } = await playlist.toggle(payload)
      if (toggleError) setError(toggleError.message)
      return { error: toggleError }
    },
    [playlist]
  )

  useEffect(() => {
    if (kidWatchTab === 'playlist' && accessToken) void playlist.refresh()
  }, [kidWatchTab, accessToken, playlist.refresh])

  useEffect(() => {
    lockManagementAppShell()
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

  const activeVideo = useMemo(() => {
    const inFiltered = filteredVideos.find((v) => v.videoId === activeVideoId)
    if (inFiltered) return inFiltered
    const inAll = channelVideos.find((v) => v.videoId === activeVideoId)
    if (videoSearch.trim() && inAll) return inAll
    return null
  }, [filteredVideos, channelVideos, activeVideoId, videoSearch])

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

  useEffect(() => {
    if (!accessToken) return
    const id = window.setInterval(() => {
      void Promise.all([childHeartbeat(accessToken), loadChildData(accessToken)]).catch((e) => {
        setError(e instanceof Error ? e.message : 'עדכון מצב נכשל')
      })
    }, 3_000)
    return () => window.clearInterval(id)
  }, [accessToken, loadChildData])

  useEffect(() => {
    const yt = activeChannelId
    if (!yt || !yt.trim()) return
    void loadChannelVideos(yt)
  }, [activeChannelId, channelPickNonce, loadChannelVideos])

  useEffect(() => {
    if (videoSearchFocused) return
    if (channelVideos.length === 0) {
      setActiveVideoId(null)
      return
    }
    if (filteredVideos.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) =>
      prev && filteredVideos.some((v) => v.videoId === prev) ? prev : filteredVideos[0].videoId
    )
  }, [channelVideos, videoSearch, filteredVideos, videoSearchFocused])

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
            setForgotInfo('נשלח מייל. אם אין כרגע קוד צימוד פעיל, צרו מכשיר חדש בלוח ההורה.')
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
          {pendingUrlPairCode ? 'מחברים את המכשיר אחרי הסריקה…' : 'טוען…'}
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
            <strong className="text-slate-800 dark:text-zinc-200">ההתקנה העיקרית כאן:</strong> התחברו כהורה באותו דפדפן (אימייל וסיסמה), צרו מכשיר בלוח הבקרה, והזינו למטה את <strong>קוד הצימוד בן 6 הספרות</strong> — החיבור נשמר במכשיר ולא יבקשו שוב התחברות הורה.
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
              {submitting ? 'מתחבר...' : 'חבר מכשיר'}
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
        <p className="mt-8 text-center text-[10px] text-slate-500 dark:text-zinc-500" dir="ltr">
          מזהה מכשיר (דיבוג): לא מחובר
        </p>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-[#f3f3f3] text-slate-900 dark:bg-[#0f0f0f] dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/90 pb-[env(safe-area-inset-top)] shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-2 px-2 py-2 sm:px-3 sm:py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SafeTubeBrandMark to="/kid" size="compact" />
            <div className="min-w-0 flex-1 text-right">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-zinc-50">
                {kidSurface === 'parent'
                  ? 'אזור הורים'
                  : kidWatchTab === 'playlist'
                    ? 'הפלייליסט שלי'
                    : device.device_name}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500">{KID_APP_DISPLAY_NAME}</p>
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-200/90 bg-slate-100/50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/80"
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
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
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
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
            >
              <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="max-[360px]:hidden sm:inline">הפלייליסט שלי</span>
              <span className="sm:hidden">פלייליסט</span>
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
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-slate-500 opacity-90 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
              }`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              הורים
            </button>
          </div>
        </div>
      </header>

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
            <p className="mt-4 text-center text-[10px] leading-relaxed text-slate-500 dark:text-zinc-500" dir="ltr">
              מזהה מכשיר (דיבוג): {device.device_id && device.device_id.length >= 4 ? `…${device.device_id.slice(-4)}` : '—'}
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
              <KidPlaylistView
                items={playlist.items}
                loading={playlist.loading}
                playlistApi={{
                  isInPlaylist: playlist.isInPlaylist,
                  toggle: handlePlaylistToggle,
                  toggleBusyId: playlist.toggleBusyId,
                }}
              />
            </div>
          ) : channels.length === 0 ? (
            <div className="px-3 py-4 sm:px-4 lg:col-span-2">
              <div className="rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-5 text-sm leading-relaxed text-amber-950 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-100">
                <p className="font-semibold">אין ערוצים שמקושרים למכשיר הזה</p>
                <p className="mt-2 text-amber-900/95 dark:text-amber-200/90">
                  בלשונית <strong className="font-bold">הורים</strong> — ניהול ערוצים, ובחרו את המכשיר &quot;{device.device_name}
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

              <div className="min-w-0 flex-1 bg-[#f3f3f3] dark:bg-[#0f0f0f] lg:pt-0">
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

                <div className="mx-auto max-w-[1600px] gap-0 px-1.5 pb-3 pt-1.5 sm:px-2 sm:pb-4 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:px-3 lg:pt-2">
                  <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row lg:gap-2">
                  <div className="min-w-0 flex-1 lg:max-w-[min(100%,1280px)]">
                    {channelLoading ? (
                      <div className="flex aspect-video max-w-5xl items-center justify-center gap-3 rounded-xl bg-black/90 text-zinc-200">
                        <LoadingSpinner className="h-9 w-9 shrink-0 border-2 border-red-500 border-t-transparent" />
                        <span className="text-base font-semibold">טוען…</span>
                      </div>
                    ) : activeVideo ? (
                      <>
                        <div className="relative w-full overflow-hidden rounded-none bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.08)] sm:rounded-xl">
                          <div className="relative pt-[56.25%]">
                            <div className="absolute inset-0 min-h-0">
                              <CleanPlayer
                                key={activeVideo.videoId}
                                videoId={activeVideo.videoId}
                                title={activeVideo.title}
                                channelTitle={activeChannel?.channel_name}
                                posterUrl={activeVideo.thumbnail}
                                onNextTrack={handlePlayerNextTrack}
                                onPreviousTrack={handlePlayerPreviousTrack}
                                hasNextTrack={hasNextChannelVideo}
                                className="h-full w-full"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-col gap-2 px-0 sm:px-1">
                          <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-zinc-50 sm:text-lg">
                            {activeVideo.title}
                          </h2>
                          <p className="text-sm text-slate-500 dark:text-zinc-500">מאושר — SafeTube</p>
                          {accessToken ? (
                            <PlaylistToggleButton
                              inPlaylist={playlist.isInPlaylist(activeVideo.videoId)}
                              busy={playlist.toggleBusyId === activeVideo.videoId}
                              onToggle={handlePlaylistToggle}
                              payload={{
                                youtube_video_id: activeVideo.videoId,
                                title: activeVideo.title,
                                thumbnail_url: activeVideo.thumbnail || null,
                                youtube_channel_id: activeChannelId,
                                channel_name: activeChannel?.channel_name ?? null,
                              }}
                            />
                          ) : null}
                        </div>
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
                          onClick={() => setVideoSearch('')}
                        >
                          מחק חיפוש
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
                        <Unplug className="h-14 w-14 text-slate-400" strokeWidth={1.75} aria-hidden />
                        <p className="text-base font-medium text-slate-700 dark:text-zinc-300">בחרו ערוץ כדי לטעון סרטונים.</p>
                      </div>
                    )}
                  </div>

                  <aside className="mt-3 min-w-0 border-t border-black/[0.06] pt-3 dark:border-zinc-800 lg:mt-0 lg:w-[min(100%,400px)] lg:shrink-0 lg:border-t-0 lg:border-s lg:pt-0 lg:ps-4 dark:lg:border-zinc-800">
                    <div className="lg:sticky lg:top-[52px] lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:pb-8 lg:pe-1">
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
                      <div className="mb-2 flex items-center gap-2">
                        <Play className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" fill="currentColor" aria-hidden />
                        <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">הסרטונים של הערוץ</p>
                      </div>
                      <ul className="no-scrollbar flex gap-2 max-lg:flex-row max-lg:overflow-x-auto max-lg:pb-1 lg:flex-col lg:gap-1.5 lg:overflow-visible">
                        {filteredVideos.length > 0
                          ? filteredVideos.map((video) => {
                              const isCurrent = video.videoId === activeVideo?.videoId
                              return (
                                <li key={video.videoId} className="max-lg:w-[min(100%,280px)] max-lg:shrink-0 lg:w-full">
                                  <div
                                    className={`flex w-full flex-col gap-2 rounded-xl p-2 transition max-lg:items-stretch lg:flex-row lg:items-start ${
                                      isCurrent
                                        ? 'bg-white shadow-md ring-2 ring-brand-500/50 dark:bg-zinc-900'
                                        : 'bg-white/60 hover:bg-white/90 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/70'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => setActiveVideoId(video.videoId)}
                                      className="flex min-w-0 flex-1 gap-2 text-right max-lg:flex-col lg:flex-row"
                                    >
                                      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-800 max-lg:max-h-[76px] lg:w-32 lg:max-h-none lg:min-w-[128px] min-[400px]:lg:w-[168px]">
                                        {video.thumbnail ? (
                                          <img
                                            src={video.thumbnail}
                                            alt=""
                                            loading="lazy"
                                            className="h-full w-full object-cover"
                                          />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-xs font-medium text-slate-500">
                                            וידאו
                                          </div>
                                        )}
                                        {isCurrent ? (
                                          <span className="absolute bottom-1.5 end-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                                            מנגן עכשיו
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="line-clamp-2 flex-1 py-1 text-start text-xs font-semibold leading-snug text-slate-800 max-lg:text-center sm:text-sm dark:text-zinc-200">
                                        {video.title}
                                      </p>
                                    </button>
                                    {accessToken ? (
                                      <PlaylistToggleButton
                                        compact
                                        inPlaylist={playlist.isInPlaylist(video.videoId)}
                                        busy={playlist.toggleBusyId === video.videoId}
                                        onToggle={handlePlaylistToggle}
                                        payload={{
                                          youtube_video_id: video.videoId,
                                          title: video.title,
                                          thumbnail_url: video.thumbnail || null,
                                          youtube_channel_id: activeChannelId,
                                          channel_name: activeChannel?.channel_name ?? null,
                                        }}
                                        className="w-full max-lg:mx-auto lg:w-auto"
                                      />
                                    ) : null}
                                  </div>
                                </li>
                              )
                            })
                          : null}
                      </ul>
                      {!channelLoading && filteredVideos.length === 0 ? (
                        <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300/90 bg-white/40 px-3 py-6 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
                          <p className="text-sm font-semibold leading-snug text-slate-700 dark:text-zinc-300">
                            {videoSearch.trim()
                              ? 'אין סרטונים שמתאימים לחיפוש.'
                              : channelVideos.length === 0
                                ? 'אין עדיין סרטונים במטמון. בקשו מההורה לרענן ערוץ בלשונית הורים.'
                                : 'אין סרטונים.'}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </aside>
                  </div>
                </div>
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
    </div>
  )
}
