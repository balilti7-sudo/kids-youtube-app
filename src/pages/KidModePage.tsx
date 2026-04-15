import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldAlert, Smartphone, Unplug } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Modal } from '../components/ui/Modal'
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
import type { ChannelVideoItem } from '../lib/youtube'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

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
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [playerNonce, setPlayerNonce] = useState(0)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [showPlayerFallback, setShowPlayerFallback] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showInstallHint, setShowInstallHint] = useState(false)
  const parentUnlockPin = import.meta.env.VITE_PARENT_UNLOCK_PIN?.trim() ?? ''

  const activeVideo = useMemo(
    () => channelVideos.find((v) => v.videoId === activeVideoId) ?? channelVideos[0] ?? null,
    [channelVideos, activeVideoId]
  )
  const categories = useMemo(() => {
    const set = new Set(channels.map((c) => c.category?.trim()).filter(Boolean) as string[])
    return ['all', ...Array.from(set)]
  }, [channels])
  const filteredChannels = useMemo(() => {
    if (selectedCategory === 'all') return channels
    return channels.filter((c) => (c.category ?? '').trim() === selectedCategory)
  }, [channels, selectedCategory])
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
    setChannelLoading(true)
    if (!accessToken) {
      setChannelLoading(false)
      return
    }
    const { data, error: cacheError } = await getChildCachedChannelVideos(accessToken, channelId)
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
    setChannelVideos(next)
    setActiveVideoId(next[0]?.videoId ?? null)
    setPlayerOpen(false)
  }, [accessToken])

  const loadChildData = useCallback(async (token: string) => {
    const [stateRes, channelsRes] = await Promise.all([getChildDeviceState(token), getChildAllowedChannels(token)])
    if (stateRes.error) throw stateRes.error
    if (!stateRes.data) throw new Error('המכשיר לא נמצא. התחברו מחדש עם קוד צימוד.')

    setDevice(stateRes.data)
    if (channelsRes.error) {
      setError(channelsRes.error.message)
      return
    }

    setError(null)
    setChannels(channelsRes.data)
    const availableIds = new Set(channelsRes.data.map((c) => c.youtube_channel_id))
    const preferred = activeChannelId && availableIds.has(activeChannelId) ? activeChannelId : channelsRes.data[0]?.youtube_channel_id ?? null
    setActiveChannelId((prev) => (prev === preferred ? prev : preferred))
    if (!preferred) {
      setChannelVideos([])
      setActiveVideoId(null)
      setPlayerOpen(false)
    }
  }, [activeChannelId])

  useEffect(() => {
    const boot = async () => {
      const token = getSavedChildAccessToken()
      if (!token) {
        setBootLoading(false)
        return
      }
      try {
        setAccessToken(token)
        await loadChildData(token)
      } catch (e) {
        // Clear token only for fatal state errors. Quota/network errors should not disconnect child mode.
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
  }, [loadChildData])

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
    if (!activeChannelId) return
    void loadChannelVideos(activeChannelId)
  }, [activeChannelId, loadChannelVideos])

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setShowInstallHint(false)
    }

    const onAppInstalled = () => {
      setInstallPrompt(null)
      setShowInstallHint(false)
      setError(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  useEffect(() => {
    if (!accessToken) return
    const onBeforeUnload = () => {
      void childMarkOffline(accessToken)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [accessToken])

  const handlePair = async () => {
    const code = pairingCode.trim()
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
  }

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
      setPinInput('')
      setPinError(null)
      setPinModalOpen(false)
      setDisconnecting(false)
    }
  }

  const confirmPinAndDisconnect = async () => {
    if (!parentUnlockPin) {
      setPinError('חסר PIN הורי. הגדירו VITE_PARENT_UNLOCK_PIN בקובץ .env והפעילו מחדש.')
      return
    }
    if (pinInput !== parentUnlockPin) {
      setPinError('PIN שגוי')
      return
    }
    await handleDisconnect()
  }

  const handleInstallApp = async () => {
    if (!installPrompt) {
      setShowInstallHint(true)
      return
    }
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  if (bootLoading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-5xl items-center justify-center px-4">
        <LoadingSpinner className="h-10 w-10 border-brand-500 border-t-transparent" />
      </div>
    )
  }

  if (!accessToken || !device) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pb-10 pt-8">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-zinc-50">SafeTube Kids</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">הזינו קוד צימוד כדי לצפות בתוכן המאושר בלבד</p>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-zinc-300">Pairing Code</label>
          <Input
            inputMode="numeric"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="לדוגמה: 123456"
            className="text-center text-lg tracking-[0.2em]"
            onKeyDown={(e) => e.key === 'Enter' && void handlePair()}
          />
          {error ? <p className="mt-2 text-sm text-danger-600">{error}</p> : null}
          <Button className="mt-4 w-full" disabled={submitting} onClick={() => void handlePair()}>
            {submitting ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {submitting ? 'מתחבר...' : 'חבר מכשיר'}
          </Button>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-3 py-3 sm:px-4">
      <header className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold text-slate-900 dark:text-zinc-50">{device.device_name}</h1>
            <p className="text-xs text-slate-500 dark:text-zinc-400">SafeTube Kids - מצב מוגן</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" className="text-xs" onClick={() => void handleInstallApp()}>
              התקן אפליקציה
            </Button>
            <Button variant="secondary" className="text-xs" onClick={() => setPinModalOpen(true)}>
              נתק מכשיר (הורה)
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={selectedCategory === cat ? 'primary' : 'secondary'}
            className="!px-3 !py-1.5 text-xs"
            onClick={() => setSelectedCategory(cat)}
          >
            {cat === 'all' ? 'הכול' : cat}
          </Button>
        ))}
      </div>
      {showInstallHint ? (
        <p className="text-xs text-zinc-500">
          אם לא הופיעה התקנה אוטומטית, בדפדפן פתחו תפריט ובחרו &quot;Add to Home screen&quot; / &quot;Install app&quot;.
        </p>
      ) : null}
      {error ? <p className="text-sm text-danger-600">{error}</p> : null}

      {device.is_blocked ? (
        <section className="rounded-2xl border border-danger-700/60 bg-danger-950/50 p-6 text-center text-danger-100">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10" />
          <h2 className="text-xl font-black">YouTube חסום כרגע</h2>
          <p className="mt-2 text-sm">הורה חסם את הצפייה מהמכשיר הזה. חכו לאישור מחדש.</p>
        </section>
      ) : (
        <section className="grid flex-1 gap-3 lg:grid-cols-[2fr,1fr,1fr]">
          <article className="rounded-2xl border border-slate-200 bg-black p-2 shadow-sm dark:border-zinc-700">
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
                    <p className="text-sm">בחרו ערוץ כדי לראות סרטונים</p>
                  </div>
                )}
              </div>
            )}
          </article>

          <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-zinc-100">ערוצים מאושרים</h2>
            <div className="grid max-h-[65vh] gap-2 overflow-auto pr-1">
              {filteredChannels.map((channel) => {
                const selected = channel.youtube_channel_id === activeChannelId
                return (
                  <button
                    key={channel.channel_id}
                    type="button"
                    onClick={() => {
                      setActiveChannelId(channel.youtube_channel_id)
                      void loadChannelVideos(channel.youtube_channel_id).catch((e) =>
                        setError(e instanceof Error ? e.message : 'טעינת סרטוני ערוץ נכשלה')
                      )
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

          <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-zinc-100">סרטונים אחרונים בערוץ</h2>
            <Input
              value={videoSearch}
              onChange={(e) => setVideoSearch(e.target.value)}
              placeholder="חיפוש בתוך הסרטונים המאוחסנים"
              className="mb-2"
            />
            {channelLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner className="h-6 w-6 border-brand-500 border-t-transparent" />
              </div>
            ) : (
              <div className="grid max-h-[65vh] gap-2 overflow-auto pr-1">
                {filteredVideos.map((video) => {
                  const selected = video.videoId === activeVideo?.videoId
                  return (
                    <button
                      key={video.videoId}
                      type="button"
                      onClick={() => {
                        setActiveVideoId(video.videoId)
                        setPlayerOpen(true)
                      }}
                      className={`flex items-center gap-2 rounded-xl border p-2 text-right transition ${
                        selected
                          ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {video.thumbnail ? (
                        <img src={video.thumbnail} alt="" className="h-14 w-20 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-14 w-20 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-zinc-800">
                          <Smartphone className="h-4 w-4" />
                        </div>
                      )}
                      <span className="line-clamp-2 text-xs font-medium text-slate-700 dark:text-zinc-200">{video.title}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </aside>
        </section>
      )}

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
        <p className="mb-2 text-sm text-slate-600 dark:text-zinc-400">להמשך ניתוק המכשיר יש להזין PIN הורי.</p>
        <Input
          type="password"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value)
            if (pinError) setPinError(null)
          }}
          placeholder="PIN הורי"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void confirmPinAndDisconnect()}
        />
        {pinError ? <p className="mt-2 text-sm text-danger-600">{pinError}</p> : null}
      </Modal>
    </main>
  )
}
