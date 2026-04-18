import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ShieldAlert, Smartphone, Unplug } from 'lucide-react'
import { Button } from '../components/ui/Button'
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
import { getResolvedParentPin, pinsMatch } from '../lib/parentPin'
import { parsePairingCodeFromScan } from '../lib/pairingCodeFromQr'
import { SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY } from '../lib/safetubeSessionKeys'
import type { ChannelVideoItem } from '../lib/youtube'
import type { Html5Qrcode } from 'html5-qrcode'

const KID_APP_DISPLAY_NAME = 'SafeTube Kids'
const PARENT_MODE_UNLOCK_MS = 10 * 60 * 1000

function buildSafeEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    autoplay: '0',
    controls: '1',
    rel: '0',
    modestbranding: '1',
    iv_load_policy: '3',
    fs: '0',
    playsinline: '1',
    disablekb: '0',
  })
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

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
  const [playerOpen, setPlayerOpen] = useState(false)
  const [videoSearch, setVideoSearch] = useState('')
  /** כל לחיצה על ערוץ (גם על אותו ערוץ) — כדי ש־useEffect יטען מחדש גם כש־activeChannelId לא משתנה */
  const [channelPickNonce, setChannelPickNonce] = useState(0)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [playerNonce, setPlayerNonce] = useState(0)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [showPlayerFallback, setShowPlayerFallback] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [parentModeUnlocked, setParentModeUnlocked] = useState(false)
  const [parentModePinOpen, setParentModePinOpen] = useState(false)
  const [parentModePinInput, setParentModePinInput] = useState('')
  const [parentModePinError, setParentModePinError] = useState<string | null>(null)
  const [pendingParentAction, setPendingParentAction] = useState<'home' | 'channels' | null>(null)
  const [showManualPairing, setShowManualPairing] = useState(false)
  const [qrScanOpen, setQrScanOpen] = useState(false)
  const [scanCameraError, setScanCameraError] = useState<string | null>(null)
  const qrScannerRef = useRef<Html5Qrcode | null>(null)
  const qrDecodeLockRef = useRef(false)
  const channelVideosRequestRef = useRef(0)
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  /** נקרא פעם אחת — לזיהוי סריקת QR לפני הסרת הפרמטר מהכתובת */
  const [pendingUrlPairCode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('code')?.trim() || null
    } catch {
      return null
    }
  })

  const activeVideo = useMemo(
    () => channelVideos.find((v) => v.videoId === activeVideoId) ?? channelVideos[0] ?? null,
    [channelVideos, activeVideoId]
  )
  const filteredVideos = useMemo(() => {
    const q = videoSearch.trim().toLowerCase()
    if (!q) return channelVideos
    return channelVideos.filter((v) => v.title.toLowerCase().includes(q))
  }, [channelVideos, videoSearch])

  useEffect(() => {
    setIframeLoaded(false)
    setShowPlayerFallback(false)
    if (!activeVideo) return
    const timeoutId = window.setTimeout(() => {
      if (!iframeLoaded) setShowPlayerFallback(true)
    }, 9_000)
    return () => window.clearTimeout(timeoutId)
  }, [activeVideo, iframeLoaded, playerNonce])

  const loadChannelVideos = useCallback(async (channelId: string) => {
    const rid = ++channelVideosRequestRef.current
    const yt = channelId.trim()
    if (!yt) {
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
    setPlayerOpen(false)
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
    const availableIds = new Set(list.map((c) => c.youtube_channel_id.trim()))

    if (list.length === 0) {
      setActiveChannelId(null)
      setChannelVideos([])
      setPlayerOpen(false)
      return
    }

    // אל תשתמשו ב-activeChannelId מהסגירה — בקשות polling ישנות יכולות לסיים אחרי בחירת ערוץ
    // ולדרוס את הבחירה; תמיד לעגנו ל־prev המעודכן מול הרשימה החדשה מהשרת.
    setActiveChannelId((prev) => {
      const p = prev?.trim() ?? ''
      if (p && availableIds.has(p)) return p
      return list[0]?.youtube_channel_id?.trim() ?? null
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
        urlCode = new URLSearchParams(window.location.search).get('code')?.trim() || null
      } catch {
        urlCode = null
      }

      if (urlCode) {
        clearChildAccessToken()
        setAccessToken(null)
        setDevice(null)
        setChannels([])
        setError(null)
        try {
          const { accessToken: token, error: pairError } = await pairChildDevice(urlCode)
          if (pairError || !token) throw pairError ?? new Error('צימוד נכשל')
          saveChildAccessToken(token)
          setAccessToken(token)
          await loadChildDataRef.current(token)
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

      const token = getSavedChildAccessToken()
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
    const yt = activeChannelId?.trim()
    if (!yt) return
    void loadChannelVideos(yt)
  }, [activeChannelId, channelPickNonce, loadChannelVideos])

  useEffect(() => {
    if (channelVideos.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) =>
      prev && channelVideos.some((v) => v.videoId === prev) ? prev : channelVideos[0].videoId
    )
  }, [channelVideos])

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
    }
  }

  const confirmPinAndDisconnect = async () => {
    const expected = getResolvedParentPin()
    if (!pinsMatch(pinInput, expected)) {
      setPinError('PIN שגוי. אותו קוד כמו בניהול ערוצים אצל ההורה (ללא הגדרה: 1234).')
      return
    }
    await handleDisconnect()
  }

  const runParentAction = (action: 'home' | 'channels') => {
    const target = action === 'home' ? '/dashboard' : '/channels'
    if (action === 'home') {
      navigate(isAuthenticated ? target : `/auth?next=${encodeURIComponent(target)}`)
      return
    }
    navigate(isAuthenticated ? target : `/auth?next=${encodeURIComponent(target)}`)
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

  const requestParentAction = (action: 'home' | 'channels') => {
    if (parentModeUnlocked) {
      runParentAction(action)
      return
    }
    setPendingParentAction(action)
    setParentModePinInput('')
    setParentModePinError(null)
    setParentModePinOpen(true)
  }

  const confirmParentModePin = () => {
    const expected = getResolvedParentPin()
    if (!pinsMatch(parentModePinInput, expected)) {
      setParentModePinError('PIN שגוי')
      return
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
                setError(null)
              }}
            >
              הזנת קוד ידנית (גיבוי)
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => requestParentAction('home')}
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
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-3 py-3 sm:px-4">
      <header className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold text-slate-900 dark:text-zinc-50">{device.device_name}</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400">{KID_APP_DISPLAY_NAME} — מצב מוגן</p>
          </div>
          <Button variant="secondary" className="shrink-0 text-xs" onClick={() => setPinModalOpen(true)}>
            נתק מכשיר (הורה)
          </Button>
        </div>
      </header>
      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      {device.is_blocked ? (
        <section className="rounded-2xl border border-danger-700/60 bg-danger-950/50 p-6 text-center text-danger-100">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10" aria-hidden />
          <h2 className="text-xl font-black tracking-tight">{KID_APP_DISPLAY_NAME}</h2>
          <p className="mt-3 text-sm leading-relaxed opacity-95">
            הצפייה חסומה כרגע מההורה. אפשר לבקש לפתוח שוב — או לנתק את המכשיר בלחיצה על &quot;נתק מכשיר&quot; למעלה (נדרש אישור הורה).
          </p>
        </section>
      ) : (
        <section className="grid flex-1 gap-3 lg:grid-cols-[2fr,1fr] [&>*]:min-w-0">
          {channels.length === 0 ? (
            <div className="lg:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-semibold">אין ערוצים שמקושרים למכשיר הזה</p>
              <p className="mt-2 text-amber-900/90 dark:text-amber-200/90">
                במסך ההורה, תחת <strong className="font-bold">ניהול ערוצים</strong>, הערוצים נוספים ל<strong className="font-bold">
                  מכשיר ספציפי
                </strong>
                . ודאו שנבחר באותו ממשק המכשיר בשם <strong className="font-bold">«{device.device_name}»</strong> — זה שם המכשיר
                שמוצג כאן למעלה. אם ההוספה בוצעה תחת מכשיר אחר, כאן לא יופיעו ערוצים עד שתקשרו אותם לאותו מכשיר.
              </p>
              <Button type="button" variant="secondary" className="mt-3" onClick={() => requestParentAction('home')}>
                פתחו ניהול הורה במכשיר הזה
              </Button>
            </div>
          ) : null}
          <article className="order-2 min-h-0 rounded-2xl border border-slate-200 bg-black p-2 shadow-sm dark:border-zinc-700 lg:order-none">
            {playerOpen && activeVideo ? (
              <>
                <div className="mb-2 flex justify-start">
                  <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => setPlayerOpen(false)}>
                    חזרה לגלריה
                  </Button>
                </div>
                <div className="relative overflow-hidden rounded-xl pt-[56.25%]">
                  <iframe
                    title={activeVideo.title}
                    src={buildSafeEmbedUrl(activeVideo.videoId)}
                    key={`${activeVideo.videoId}-${playerNonce}`}
                    className="absolute inset-0 h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    sandbox="allow-scripts allow-same-origin allow-presentation"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen={false}
                    onLoad={() => {
                      setIframeLoaded(true)
                      setShowPlayerFallback(false)
                    }}
                  />
                  <div className="pointer-events-auto absolute right-0 top-0 h-12 w-20" aria-hidden />
                  {showPlayerFallback ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-4 text-center">
                      <p className="text-sm text-zinc-100">YouTube לא נטען כרגע. זה קורה לפעמים בגלל הגנת אנטי-בוט.</p>
                      <Button
                        variant="secondary"
                        className="!bg-white/90 !text-slate-900 hover:!bg-white"
                        onClick={() => {
                          setPlayerNonce((n) => n + 1)
                          setIframeLoaded(false)
                          setShowPlayerFallback(false)
                        }}
                      >
                        נסה שוב
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 px-1 text-sm font-semibold text-zinc-100">{activeVideo.title}</p>
              </>
            ) : (
              <div className="grid gap-3 p-1 sm:grid-cols-2">
                {channelLoading ? (
                  <div className="flex items-center justify-center gap-3 rounded-xl border border-brand-500/35 bg-zinc-900/95 px-4 py-4 sm:col-span-2">
                    <LoadingSpinner className="h-7 w-7 shrink-0 border-2 border-brand-500 border-t-transparent" />
                    <span className="text-sm font-semibold text-zinc-100">טוען סרטונים מהמטמון…</span>
                  </div>
                ) : null}
                <Input
                  value={videoSearch}
                  onChange={(e) => setVideoSearch(e.target.value)}
                  placeholder="חיפוש בתוך סרטוני הערוץ"
                  className="border-zinc-600 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 sm:col-span-2"
                />
                {filteredVideos.length > 0 ? (
                  filteredVideos.map((video) => (
                    <button
                      key={video.videoId}
                      type="button"
                      onClick={() => {
                        setActiveVideoId(video.videoId)
                        setPlayerOpen(true)
                      }}
                      className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 text-right transition hover:border-brand-500"
                    >
                      {video.thumbnail ? (
                        <img src={video.thumbnail} alt="" className="h-36 w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-36 w-full items-center justify-center bg-zinc-800">
                          <Smartphone className="h-5 w-5 text-zinc-500" />
                        </div>
                      )}
                      <p className="line-clamp-2 px-3 py-2 text-sm font-semibold text-zinc-100">{video.title}</p>
                    </button>
                  ))
                ) : (
                  <div className="col-span-full flex h-full min-h-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 text-zinc-300">
                    <Unplug className="h-8 w-8 text-zinc-500" />
                    <p className="max-w-sm text-center text-sm">
                      {channelLoading
                        ? 'טוענים סרטונים…'
                        : videoSearch.trim()
                          ? 'אין תוצאות לחיפוש — נסו מילה אחרת או רוקנו את שדה החיפוש למעלה.'
                          : channels.length === 0
                            ? 'אין ערוצים במכשיר הזה. ההורה מוסיף ערוצים במסך הניהול — ודאו שמקושרים לאותו מכשיר.'
                            : channelVideos.length === 0
                              ? 'יש ערוצים ברשימה, אבל אין סרטונים במטמון. במסך ההורה: &quot;רענון סרטוני ערוץ&quot; לערוץ הזה, או הוסיפו את הערוץ מחדש (סנכרון אוטומטי אחרי האישור).'
                              : 'בחרו ערוץ מהרשימה כדי לטעון סרטונים מהמטמון.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </article>

          <aside className="relative z-10 order-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 lg:order-none">
            <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-zinc-100">ערוצים מאושרים</h2>
            <div className="grid max-h-[65vh] touch-manipulation gap-2 overflow-y-auto overscroll-contain pr-1">
              {channels.map((channel) => {
                const yt = channel.youtube_channel_id.trim()
                const selected = yt === (activeChannelId?.trim() ?? '')
                return (
                  <button
                    key={channel.channel_id}
                    type="button"
                    onClick={() => {
                      setActiveChannelId(yt)
                      setChannelPickNonce((n) => n + 1)
                    }}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-right transition ${
                      selected
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {channel.channel_thumbnail ? (
                      <img
                        src={channel.channel_thumbnail}
                        alt=""
                        className="h-14 w-20 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-zinc-800">
                        <Smartphone className="h-4 w-4" />
                      </div>
                    )}
                    <span className="line-clamp-2 text-xs font-medium text-slate-700 dark:text-zinc-200">
                      {channel.channel_name}
                    </span>
                    {channel.category ? <span className="text-[11px] text-brand-500">{channel.category}</span> : null}
                  </button>
                )
              })}
            </div>
          </aside>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-800 dark:text-zinc-100">מצב הורה במכשיר הזה</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
          אם כבר התחברתם כהורה באותו דפדפן — עוברים ללוח בלי להקליד שוב אימייל. מכשיר נשאר מצומד ב־localStorage עד ניתוק מפורש.
        </p>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-zinc-500">
          {parentModeUnlocked ? 'מצב הורה פתוח ל-10 דקות במכשיר הזה.' : 'מצב הורה נעול. פתיחה דורשת PIN הורה.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="text-xs" onClick={() => requestParentAction('home')}>
            {isAuthenticated ? 'לוח בקרה (כבר מחוברים)' : 'התחברות הורה'}
          </Button>
          <Button type="button" variant="secondary" className="text-xs" onClick={() => requestParentAction('channels')}>
            {isAuthenticated ? 'ניהול ערוצים' : 'התחברו כדי לנהל ערוצים'}
          </Button>
          {parentModeUnlocked ? (
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              onClick={lockParentMode}
            >
              נעל מצב הורה
            </Button>
          ) : null}
        </div>
      </section>

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
            <Button onClick={confirmParentModePin}>אשר</Button>
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
          onKeyDown={(e) => e.key === 'Enter' && confirmParentModePin()}
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

      <p className="mt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-[10px] leading-relaxed text-slate-500 dark:text-zinc-500" dir="ltr">
        מזהה מכשיר (דיבוג): …
        {device.device_id && device.device_id.length >= 4 ? device.device_id.slice(-4) : '—'}
      </p>
    </main>
  )
}
