import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, Lock, Plus, RefreshCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel } from '../../types'
import { extractYouTubeVideoId } from '../../lib/youtube'
import { getChildCachedChannelVideos } from '../../lib/childDevice'
import { supabase } from '../../lib/supabase'
import { WhitelistView } from './WhitelistView'
import { ChannelSearch } from './ChannelSearch'
import { RemoveChannelModal } from './RemoveChannelModal'
import { CleanPlayer } from '../player/CleanPlayer'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { toast } from 'sonner'
import { Skeleton } from '../ui/Skeleton'
import { getResolvedParentPin, pinsMatch } from '../../lib/parentPin'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'

type PreviewRow = { videoId: string; title: string; thumbnail: string | null }

export function ChannelManager() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const localParentPinForRpcRef = useRef<string | null>(null)
  const getLocalParentPin = useCallback(() => localParentPinForRpcRef.current, [])
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addingChannelByUrl, setAddingChannelByUrl] = useState(false)
  const [channelUrlInput, setChannelUrlInput] = useState('')
  const [channelCategory, setChannelCategory] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [refreshingChannelId, setRefreshingChannelId] = useState<string | null>(null)
  const [manageLocked, setManageLocked] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [previewChannel, setPreviewChannel] = useState<WhitelistedChannel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVideos, setPreviewVideos] = useState<PreviewRow[]>([])
  const [activePreviewVideoId, setActivePreviewVideoId] = useState<string | null>(null)
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const managementPin = getResolvedParentPin()

  /** אחרי אימות PIN באמצעות לחיצה על "הוסף" / חיפוש — להריץ פעולה שנחסמה כשהמסך היה נעול */
  const pendingAfterUnlockRef = useRef<'addChannelUrl' | 'openChannelSearch' | null>(null)

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    search,
    loadWhitelist,
    addChannelByUrlOrId,
    refreshChannelVideosCache,
    addToWhitelist,
    removeFromWhitelist,
  } = useChannels(deviceId ?? undefined, user?.id ?? ownerUserId, {
    localAccessToken: localParent.isActive ? localParent.localAccessToken : null,
    getLocalParentPin: localParent.isActive ? getLocalParentPin : undefined,
  })

  useEffect(() => {
    if (!deviceId && devices[0]?.id) setDeviceId(devices[0].id)
  }, [devices, deviceId])

  useEffect(() => {
    if (localParent.isActive) {
      localParentPinForRpcRef.current = localParent.pin ?? ''
      setManageLocked(false)
    }
  }, [localParent.isActive, localParent.pin])

  useEffect(() => {
    loadWhitelist()
  }, [deviceId, loadWhitelist])

  const handleAdd = async (c: import('../../types').YouTubeChannelResult) => {
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingId(c.channelId)
    const { error } = await addToWhitelist(c, channelCategory.trim() || null)
    setAddingId(null)
    if (error) toast.error(error.message)
    else {
      toast.success(`הערוץ נוסף וסונכרן למכשיר ${selectedDevice.name}`)
      setSearchOpen(false)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoveLoading(true)
    const { error } = await removeFromWhitelist(removeTarget.id)
    setRemoveLoading(false)
    if (error) toast.error(error.message)
    else {
      toast.success('הוסר')
      setRemoveTarget(null)
    }
  }

  const handleAddChannelByUrl = async () => {
    const trimmed = channelUrlInput.trim()
    if (!trimmed) {
      toast.error('הדביקו לינק לערוץ YouTube')
      return
    }
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingChannelByUrl(true)
    try {
      const looksLikeVideo = Boolean(extractYouTubeVideoId(trimmed))
      if (looksLikeVideo) {
        toast.error('האפליקציה מאשרת רק ערוצים שלמים, לא סרטון בודד. הדביקו לינק לערוץ או חפשו ערוץ.')
        return
      }

      const { error } = await addChannelByUrlOrId(trimmed, channelCategory.trim() || null)
      if (error) {
        toast.error(error.message)
        return
      }
      setChannelUrlInput('')
      toast.success(`הערוץ נוסף וסונכרן למכשיר ${selectedDevice.name}`)
    } finally {
      setAddingChannelByUrl(false)
    }
  }

  const handleRefreshChannelVideos = async (channelId: string, ytChannelId: string, force = true) => {
    setRefreshingChannelId(channelId)
    const { error } = await refreshChannelVideosCache(channelId, ytChannelId, force)
    setRefreshingChannelId(null)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('סרטוני הערוץ עודכנו במטמון')
  }

  const runPendingAfterUnlock = () => {
    const p = pendingAfterUnlockRef.current
    pendingAfterUnlockRef.current = null
    if (p === 'addChannelUrl') void handleAddChannelByUrl()
    if (p === 'openChannelSearch') setSearchOpen(true)
  }

  const handleUnlockManagement = () => {
    if (!managementPin) {
      localParentPinForRpcRef.current = getResolvedParentPin()
      setManageLocked(false)
      setPinModalOpen(false)
      setPinInput('')
      setPinError(null)
      toast.success('מסך ההוספה נפתח (ללא PIN מוגדר)')
      runPendingAfterUnlock()
      return
    }
    if (!pinsMatch(pinInput, managementPin)) {
      setPinError('PIN שגוי')
      return
    }
    localParentPinForRpcRef.current = pinInput.replace(/\s+/g, '').trim()
    setManageLocked(false)
    setPinModalOpen(false)
    setPinInput('')
    setPinError(null)
    toast.success('מסך ההוספה נפתח — אפשר להוסיף ערוצים')
    runPendingAfterUnlock()
  }

  const requestAddChannelByUrl = () => {
    if (manageLocked) {
      pendingAfterUnlockRef.current = 'addChannelUrl'
      setPinModalOpen(true)
      return
    }
    void handleAddChannelByUrl()
  }

  const requestOpenChannelSearch = () => {
    if (manageLocked) {
      pendingAfterUnlockRef.current = 'openChannelSearch'
      setPinModalOpen(true)
      return
    }
    setSearchOpen(true)
  }

  useEffect(() => {
    if (whitelist.length === 0 || refreshingChannelId) return
    const stale = whitelist.find((c) => {
      if (!c.last_videos_refresh_at) return true
      return Date.now() - new Date(c.last_videos_refresh_at).getTime() > 24 * 60 * 60 * 1000
    })
    if (!stale) return
    void handleRefreshChannelVideos(stale.id, stale.youtube_channel_id, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whitelist])

  useEffect(() => {
    const channel = previewChannel
    if (!channel) {
      setPreviewLoading(false)
      setPreviewError(null)
      setPreviewVideos([])
      setActivePreviewVideoId(null)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewVideos([])
    setActivePreviewVideoId(null)

    void (async () => {
      try {
        let rows: PreviewRow[] = []
        if (localParent.isActive && localParent.localAccessToken) {
          const { data, error } = await getChildCachedChannelVideos(localParent.localAccessToken, channel.youtube_channel_id)
          if (error) throw error
          rows = (data ?? []).map((v) => ({
            videoId: v.youtube_video_id,
            title: v.title,
            thumbnail: v.thumbnail_url,
          }))
        } else if (user) {
          const { data, error } = await supabase
            .from('channel_videos_cache')
            .select('youtube_video_id, title, thumbnail_url, position')
            .eq('channel_id', channel.id)
            .order('position', { ascending: true })
          if (error) throw new Error(error.message)
          rows = (data ?? []).map((r) => {
            const row = r as { youtube_video_id: string; title: string; thumbnail_url: string | null }
            return {
              videoId: row.youtube_video_id,
              title: row.title,
              thumbnail: row.thumbnail_url,
            }
          })
        } else {
          throw new Error('אין הרשאה מקומית לטעון סרטוני ערוץ.')
        }

        if (cancelled) return
        setPreviewVideos(rows)
        setActivePreviewVideoId(rows[0]?.videoId ?? null)
      } catch (e) {
        if (cancelled) return
        setPreviewError(e instanceof Error ? e.message : 'טעינת סרטונים נכשלה')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [previewChannel, localParent.isActive, localParent.localAccessToken, user])

  const activePreviewVideo = previewVideos.find((v) => v.videoId === activePreviewVideoId) ?? null
  const handlePickPreviewVideo = (video: PreviewRow) => {
    console.log('VIDEO CLICKED', video)
    setActivePreviewVideoId(video.videoId)
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pb-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ערוצים</h1>
        {manageLocked ? (
          <div
            className="rounded-2xl border-2 border-amber-500/85 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm dark:border-amber-500/55 dark:from-amber-950/50 dark:to-zinc-900/80"
            role="region"
            aria-label="אימות הורה נדרש"
          >
            <p className="text-base font-extrabold leading-snug text-amber-950 dark:text-amber-100">
              לפני שמוסיפים תוכן — צעד הכרחי להורה
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-950/90 dark:text-amber-100/90">
              מסך ההוספה נעול כדי שהילד לא ישנה את הרשימות. כדי להשלים את החיבור והתוכן למכשיר של הילד, יש לאמת שאתם ההורה באמצעות הקוד (PIN).
            </p>
            <Button
              type="button"
              className="mt-4 w-full gap-2 py-3.5 text-base font-bold shadow-md ring-2 ring-brand-500/30"
              onClick={() => setPinModalOpen(true)}
            >
              <KeyRound className="h-5 w-5 shrink-0" aria-hidden />
              הזינו PIN והמשיכו להוספת ערוצים
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/50 bg-emerald-50/90 px-3 py-2.5 dark:border-emerald-700/50 dark:bg-emerald-950/35">
            <p className="min-w-0 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              ניהול פתוח — אפשר להוסיף או להסיר תוכן
            </p>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 !px-3 !py-2 text-xs font-semibold"
              disabled
              title="הדשבורד לא דורש PIN (ה-PIN נשמר אחרי הזנה במסך הילד)."
            >
              <Lock className="h-4 w-4" />
              נעל את מסך ההוספה
            </Button>
          </div>
        )}
        {selectedDevice ? (
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            המכשיר הפעיל כעת: <span className="font-semibold text-slate-700 dark:text-zinc-200">{selectedDevice.name}</span>
          </p>
        ) : null}
        {devices.length > 1 ? (
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={deviceId ?? ''}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs text-slate-500 dark:text-zinc-400">
            הדביקו כאן <strong className="text-slate-700 dark:text-zinc-300">רק לינק לערוץ</strong> (דף ערוץ / @handle / channel/…). קישור לסרטון בודד לא יתקבל — צריך לאשר את הערוץ כולו.
          </p>
          <Input
            placeholder="קטגוריה (למשל: Songs / Stories / Education)"
            value={channelCategory}
            onChange={(e) => setChannelCategory(e.target.value)}
            className="mb-2"
          />
          <div className="flex gap-2">
            <Input
              dir="ltr"
              placeholder="https://www.youtube.com/@ערוץ או .../channel/UC..."
              value={channelUrlInput}
              onChange={(e) => setChannelUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void requestAddChannelByUrl()}
            />
            <Button onClick={() => void requestAddChannelByUrl()} disabled={addingChannelByUrl}>
              {addingChannelByUrl ? '...' : 'הוסף'}
            </Button>
          </div>
        </div>
      </header>

      {devLoading || listLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : devices.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-zinc-400">הוסיפו מכשיר כדי לנהל ערוצים.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <WhitelistView
            channels={whitelist}
            onRemoveRequest={setRemoveTarget}
            onPreviewRequest={(c) => setPreviewChannel(c)}
            manageLocked={manageLocked}
          />
          {previewChannel ? (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  ניגון ערוץ: {previewChannel.channel_name}
                </p>
                <Button
                  variant="secondary"
                  className="!px-3 !py-2 text-xs"
                  onClick={() => setPreviewChannel(null)}
                >
                  סגור נגן
                </Button>
              </div>
              {previewLoading ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">טוען סרטונים מהמטמון…</p>
              ) : previewError ? (
                <p className="text-sm text-danger-600">{previewError}</p>
              ) : activePreviewVideo ? (
                <>
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black pt-[56.25%] shadow-sm dark:border-zinc-700">
                    <div className="absolute inset-0 min-h-0">
                      <CleanPlayer
                        key={activePreviewVideo.videoId}
                        videoId={activePreviewVideo.videoId}
                        title={activePreviewVideo.title}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                  <h3 className="mt-3 text-base font-bold leading-snug text-slate-900 dark:text-zinc-100">
                    {activePreviewVideo.title}
                  </h3>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {import.meta.env.DEV
                      ? (console.log('ACTIVE VIDEO LIST RENDER', { fileName: 'src/components/channels/ChannelManager.tsx' }), null)
                      : null}
                    {previewVideos.map((v) => {
                      const isCurrent = v.videoId === activePreviewVideo.videoId
                      return (
                        <PreviewVideoCard
                          key={v.videoId}
                          video={v}
                          active={isCurrent}
                          onClick={handlePickPreviewVideo}
                        />
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-zinc-400">אין סרטונים במטמון לערוץ זה.</p>
              )}
            </section>
          ) : null}
          {whitelist.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">רענון סרטוני ערוץ (Cache)</p>
              <div className="grid gap-2">
                {whitelist.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 dark:border-zinc-800">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">{c.channel_name}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-500">
                        רענון אחרון: {c.last_videos_refresh_at ? new Date(c.last_videos_refresh_at).toLocaleString() : 'עדיין לא רוענן'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 !px-3 !py-2 text-xs"
                      onClick={() => void handleRefreshChannelVideos(c.id, c.youtube_channel_id)}
                      disabled={refreshingChannelId === c.id}
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      {refreshingChannelId === c.id ? 'מרענן...' : 'רענן'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="fixed bottom-24 left-4 right-4 z-30 mx-auto flex max-w-lg shadow-lg">
        <Button
          type="button"
          className="min-h-[48px] w-full gap-2 px-2 text-sm font-bold shadow-md sm:text-base"
          onClick={() => requestOpenChannelSearch()}
        >
          <Plus className="h-5 w-5 shrink-0" />
          חיפוש ערוץ
        </Button>
      </div>

      <ChannelSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={search}
        results={searchResults}
        loading={searchLoading}
        error={searchError}
        onAdd={handleAdd}
        addingId={addingId}
        deviceLabel={selectedDevice?.name}
        manageLocked={manageLocked}
      />

      <RemoveChannelModal
        open={Boolean(removeTarget)}
        channel={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        loading={removeLoading}
      />

      <Modal
        open={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false)
          setPinInput('')
          setPinError(null)
          pendingAfterUnlockRef.current = null
        }}
        title="אימות הורה"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPinModalOpen(false)}>
              ביטול
            </Button>
            <Button onClick={handleUnlockManagement}>המשך</Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          הזינו את קוד ההורה (4 ספרות). כך מוודאים שרק אתם מוסיפים או מסירים תוכן עבור המכשיר של הילד.
        </p>
        <p className="mb-3 rounded-lg border border-brand-200/80 bg-brand-50/90 px-3 py-2 text-xs leading-relaxed text-brand-900 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-100/95">
          פתחתם מלחיצה על &quot;הוסף&quot; או &quot;חיפוש ערוץ&quot;? אחרי קוד נכון — הפעולה תמשיך אוטומטית.
        </p>
        <Input
          type="password"
          placeholder="4 ספרות"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))
            if (pinError) setPinError(null)
          }}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleUnlockManagement()}
        />
        {pinError ? <p className="mt-2 text-sm text-danger-600">{pinError}</p> : null}
      </Modal>
    </div>
  )
}

function PreviewVideoCard({
  video,
  active,
  onClick,
}: {
  video: PreviewRow
  active: boolean
  onClick: (video: PreviewRow) => void
}) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- explicit click target tracing requested
    console.log('REAL CLICK TARGET RENDERED', {
      file: 'src/components/channels/ChannelManager.tsx',
      component: 'PreviewVideoCard',
      props: {
        videoId: video.videoId,
        title: video.title,
        active,
      },
    })
  }
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-right transition ${
        active
          ? 'bg-slate-100 ring-1 ring-brand-500/40 dark:bg-zinc-800'
          : 'hover:bg-slate-50 dark:hover:bg-zinc-800/70'
      } pointer-events-auto`}
      onClick={() => {
        // eslint-disable-next-line no-console -- explicit click target tracing requested
        console.log('VIDEO CLICKED', {
          file: 'src/components/channels/ChannelManager.tsx',
          component: 'PreviewVideoCard',
          props: {
            videoId: video.videoId,
            title: video.title,
            active,
          },
        })
        onClick(video)
      }}
    >
      <div className="pointer-events-none relative h-12 w-20 shrink-0 overflow-hidden rounded bg-slate-100 dark:bg-zinc-800">
        {video.thumbnail ? (
          <img src={video.thumbnail} alt="" loading="lazy" className="pointer-events-none h-full w-full object-cover" />
        ) : null}
      </div>
      <span className="line-clamp-2 text-xs font-medium text-slate-800 dark:text-zinc-200">{video.title}</span>
    </button>
  )
}
