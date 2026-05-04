import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, RefreshCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
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
import { getExpectedChannelActionPin, pinsMatch } from '../../lib/parentPin'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'

type PreviewRow = { videoId: string; title: string; thumbnail: string | null }

type PendingPinAction =
  | { kind: 'openSearch' }
  | { kind: 'add'; channel: YouTubeChannelResult }
  | { kind: 'remove'; channel: WhitelistedChannel }

export function ChannelManager() {
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const localParentPinForRpcRef = useRef<string | null>(null)
  const getLocalParentPin = useCallback(() => localParentPinForRpcRef.current, [])
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addedSearchChannelIds, setAddedSearchChannelIds] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [channelCategory, setChannelCategory] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [refreshingChannelId, setRefreshingChannelId] = useState<string | null>(null)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [previewChannel, setPreviewChannel] = useState<WhitelistedChannel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVideos, setPreviewVideos] = useState<PreviewRow[]>([])
  const [activePreviewVideoId, setActivePreviewVideoId] = useState<string | null>(null)
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null

  const pendingPinActionRef = useRef<PendingPinAction | null>(null)

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    search,
    loadWhitelist,
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
    }
  }, [localParent.isActive, localParent.pin])

  useEffect(() => {
    loadWhitelist()
  }, [deviceId, loadWhitelist])

  const handleAdd = async (c: YouTubeChannelResult) => {
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingId(c.channelId)
    const { error } = await addToWhitelist(c, channelCategory.trim() || null)
    setAddingId(null)
    if (error) toast.error(error.message)
    else {
      setAddedSearchChannelIds((prev) => new Set(prev).add(c.channelId))
      toast.success(`הערוץ נוסף וסונכרן למכשיר ${selectedDevice.name}`)
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

  const beginPinGate = (action: PendingPinAction) => {
    pendingPinActionRef.current = action
    setPinInput('')
    setPinError(null)
    setPinModalOpen(true)
  }

  const runAfterVerifiedPin = (trimmedPin: string) => {
    if (localParent.isActive) {
      localParentPinForRpcRef.current = trimmedPin
    }
    const pending = pendingPinActionRef.current
    pendingPinActionRef.current = null
    setPinModalOpen(false)
    setPinInput('')
    setPinError(null)

    if (!pending) return
    if (pending.kind === 'openSearch') {
      setSearchOpen(true)
      return
    }
    if (pending.kind === 'add') {
      void handleAdd(pending.channel)
      return
    }
    setRemoveTarget(pending.channel)
  }

  const submitChannelActionPin = () => {
    const expected = getExpectedChannelActionPin(profile, localParent)
    const trimmed = pinInput.replace(/\s+/g, '').trim()
    if (!pinsMatch(trimmed, expected)) {
      setPinError('קוד שגוי')
      return
    }
    runAfterVerifiedPin(trimmed)
  }

  const requestOpenChannelSearch = () => {
    beginPinGate({ kind: 'openSearch' })
  }

  const requestAddChannel = (c: YouTubeChannelResult) => {
    beginPinGate({ kind: 'add', channel: c })
  }

  const requestRemoveChannel = (c: WhitelistedChannel) => {
    beginPinGate({ kind: 'remove', channel: c })
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ערוצים</h1>
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          פתיחת חיפוש ערוץ, הוספת ערוץ או הסרת ערוץ דורשים הזנת קוד ההורה מהחשבון.
        </p>
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
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <Input
            placeholder="קטגוריה לערוץ (אופציונלי)"
            value={channelCategory}
            onChange={(e) => setChannelCategory(e.target.value)}
            className="mb-2"
          />
          <Button type="button" className="min-h-[48px] w-full gap-2 text-sm font-bold sm:text-base" onClick={requestOpenChannelSearch}>
            <Plus className="h-5 w-5 shrink-0" />
            חיפוש ערוץ
          </Button>
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
            onRemoveRequest={requestRemoveChannel}
            onPreviewRequest={(c) => setPreviewChannel(c)}
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

      <ChannelSearch
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false)
          setAddedSearchChannelIds(new Set())
        }}
        onSearch={search}
        results={searchResults}
        loading={searchLoading}
        error={searchError}
        onAdd={requestAddChannel}
        addingId={addingId}
        addedIds={addedSearchChannelIds}
        deviceLabel={selectedDevice?.name}
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
          pendingPinActionRef.current = null
        }}
        title="אימות הורה"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPinModalOpen(false)
                setPinInput('')
                setPinError(null)
                pendingPinActionRef.current = null
              }}
            >
              ביטול
            </Button>
            <Button onClick={submitChannelActionPin}>המשך</Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          הזינו את קוד ההורה מהפרופיל (ברירת מחדל 0000 אם לא שיניתם). רק אחרי קוד נכון תתבצע הפעולה שביקשתם.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="קוד הורה"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/\D/g, '').slice(0, 16))
            if (pinError) setPinError(null)
          }}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && submitChannelActionPin()}
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
