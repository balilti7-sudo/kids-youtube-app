import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, RefreshCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel, YouTubeChannelResult, YouTubeVideoResult } from '../../types'
import { supabase } from '../../lib/supabase'
import { WhitelistView } from './WhitelistView'
import { ChannelSearch } from './ChannelSearch'
import { RemoveChannelModal } from './RemoveChannelModal'
import { CleanPlayer } from '../player/CleanPlayer'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { toast } from 'sonner'
import { Skeleton } from '../ui/Skeleton'
import { Modal } from '../ui/Modal'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import { HideVideoButton } from './HideVideoButton'
import { ParentChannelVideoSearch, type ParentVideoSearchMode } from './ParentChannelVideoSearch'
import { filterVideosByTitle } from '../../lib/filterVideosByTitle'
import { listHiddenVideoIdsForDevice, listHiddenVideoIdsLocalParent } from '../../lib/hiddenVideos'

type PreviewRow = { videoId: string; title: string; thumbnail: string | null }

type PendingPinAction =
  | { kind: 'openSearch' }
  | { kind: 'add'; channel: YouTubeChannelResult }
  | { kind: 'remove'; channel: WhitelistedChannel }

export function ChannelManager() {
  const navigate = useNavigate()
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
  const [addSuccessModalOpen, setAddSuccessModalOpen] = useState(false)
  const [previewChannel, setPreviewChannel] = useState<WhitelistedChannel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVideos, setPreviewVideos] = useState<PreviewRow[]>([])
  const [activePreviewVideoId, setActivePreviewVideoId] = useState<string | null>(null)
  const [previewVideoSearch, setPreviewVideoSearch] = useState('')
  const [previewSearchMode, setPreviewSearchMode] = useState<ParentVideoSearchMode>('channel')
  const [hiddenVideoIds, setHiddenVideoIds] = useState<Set<string>>(new Set())
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null

  const pendingPinActionRef = useRef<PendingPinAction | null>(null)

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    videoSearchResults,
    videoSearchLoading,
    videoSearchError,
    search,
    searchVideos,
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
    if (!localParent.isActive && !selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingId(c.channelId)
    try {
      const { error } = await addToWhitelist(c, channelCategory.trim() || null)
      if (error) {
        console.error('[ChannelManager] addToWhitelist failed', error.message, c.channelId)
        toast.error(error.message)
        return
      }
      setAddedSearchChannelIds((prev) => new Set(prev).add(c.channelId))
      setAddSuccessModalOpen(true)
    } catch (e) {
      console.error('[ChannelManager] handleAdd unexpected error', e)
      toast.error(e instanceof Error ? e.message : 'שגיאה בהוספת ערוץ')
    } finally {
      setAddingId(null)
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
    setPinModalOpen(true)
  }

  const verifyChannelParentPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        { userId: user?.id, profile, localParent: { isActive: localParent.isActive, pin: localParent.pin } },
        pin
      ),
    [user?.id, profile, localParent]
  )

  const runAfterVerifiedPin = (trimmedPin: string) => {
    if (localParent.isActive) {
      localParentPinForRpcRef.current = trimmedPin
    }
    const pending = pendingPinActionRef.current
    pendingPinActionRef.current = null
    setPinModalOpen(false)

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
      setPreviewVideoSearch('')
      setPreviewSearchMode('channel')
      setHiddenVideoIds(new Set())
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewVideos([])
    setActivePreviewVideoId(null)
    setPreviewVideoSearch('')

    void (async () => {
      try {
        let rows: PreviewRow[] = []
        let hidden = new Set<string>()

        if (localParent.isActive && localParent.localAccessToken) {
          const pin = getLocalParentPin?.() ?? ''
          const { data, error } = await supabase.rpc('local_parent_list_channel_videos', {
            p_access_token: localParent.localAccessToken,
            p_pin: pin,
            p_youtube_channel_id: channel.youtube_channel_id,
          })
          if (error) throw new Error(error.message)
          rows = ((data ?? []) as Record<string, unknown>[]).map((v) => {
            const row = v as { youtube_video_id: string; title: string; thumbnail_url: string | null }
            return {
              videoId: row.youtube_video_id,
              title: row.title,
              thumbnail: row.thumbnail_url,
            }
          })
          const hidRes = await listHiddenVideoIdsLocalParent(localParent.localAccessToken, pin)
          hidden = hidRes.data
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
          if (deviceId) {
            const hidRes = await listHiddenVideoIdsForDevice(deviceId)
            hidden = hidRes.data
          }
        } else {
          throw new Error('אין הרשאה מקומית לטעון סרטוני ערוץ.')
        }

        if (cancelled) return
        setPreviewVideos(rows)
        setHiddenVideoIds(hidden)
        const visible = rows.filter((r) => !hidden.has(r.videoId))
        setActivePreviewVideoId(visible[0]?.videoId ?? null)
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
  }, [previewChannel, localParent.isActive, localParent.localAccessToken, user, deviceId, getLocalParentPin])

  const filteredPreviewVideos = useMemo(
    () =>
      previewSearchMode === 'channel'
        ? filterVideosByTitle(previewVideos, previewVideoSearch)
        : previewVideos,
    [previewVideos, previewVideoSearch, previewSearchMode]
  )

  const baseVisiblePreviewCount = useMemo(
    () => previewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)).length,
    [previewVideos, hiddenVideoIds]
  )

  /** Visible to parent in channel preview — hidden videos live only on /hidden-videos */
  const visiblePreviewVideos = useMemo(
    () => filteredPreviewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)),
    [filteredPreviewVideos, hiddenVideoIds]
  )

  const activePreviewVideo =
    visiblePreviewVideos.find((v) => v.videoId === activePreviewVideoId) ??
    visiblePreviewVideos[0] ??
    null

  const handleYoutubeVideoSearch = useCallback(
    (query: string) => {
      void searchVideos(query)
    },
    [searchVideos]
  )

  const renderYoutubeSearchResults = useCallback(
    (results: YouTubeVideoResult[]) => (
      <div className="max-h-72 space-y-2 overflow-y-auto">
        {results.map((v) => (
          <div
            key={v.videoId}
            className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/40"
          >
            {v.thumbnail ? (
              <img
                src={v.thumbnail}
                alt=""
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-14 w-24 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800"
              />
            ) : (
              <div className="h-14 w-24 shrink-0 rounded-lg bg-slate-100 dark:bg-zinc-800" />
            )}
            <div className="min-w-0 flex-1 text-right">
              <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-zinc-100">{v.title}</p>
              {v.channelTitle ? (
                <p className="truncate text-xs text-slate-500 dark:text-zinc-500">{v.channelTitle}</p>
              ) : null}
            </div>
            {user?.id || localParent.localAccessToken ? (
              <AddToPlaylistButton
                mode={user?.id ? 'parent' : 'kid'}
                userId={user?.id ? (ownerUserId ?? user.id) : null}
                childAccessToken={user?.id ? null : localParent.localAccessToken}
                compact
                video={{
                  youtube_video_id: v.videoId,
                  title: v.title,
                  thumbnail_url: v.thumbnail,
                  channel_name: v.channelTitle || null,
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    ),
    [user?.id, ownerUserId, localParent.localAccessToken]
  )

  const goPrevManagerPreview = useCallback(() => {
    if (!activePreviewVideoId) return
    const idx = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
    if (idx > 0) setActivePreviewVideoId(visiblePreviewVideos[idx - 1].videoId)
  }, [visiblePreviewVideos, activePreviewVideoId])

  const goNextManagerPreview = useCallback(() => {
    if (!activePreviewVideoId) return
    const idx = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
    if (idx >= 0 && idx < visiblePreviewVideos.length - 1) {
      setActivePreviewVideoId(visiblePreviewVideos[idx + 1].videoId)
    }
  }, [visiblePreviewVideos, activePreviewVideoId])

  const handleHidden = useCallback(
    (videoId: string) => {
      setHiddenVideoIds((prev) => {
        const next = new Set(prev).add(videoId)
        setActivePreviewVideoId((current) => {
          if (current !== videoId) return current
          const remaining = previewVideos.filter((v) => v.videoId !== videoId && !prev.has(v.videoId))
          const searched = filterVideosByTitle(remaining, previewVideoSearch)
          return searched[0]?.videoId ?? null
        })
        return next
      })
    },
    [previewVideos, previewVideoSearch]
  )

  const handlePickPreviewVideo = (video: PreviewRow) => {
    console.log('VIDEO CLICKED', video)
    setActivePreviewVideoId(video.videoId)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3">
      <header className="flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-2">
          <WhitelistView
            channels={whitelist}
            onRemoveRequest={requestRemoveChannel}
            onPreviewRequest={(c) => {
              setPreviewVideoSearch('')
              setPreviewChannel(c)
            }}
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
              ) : previewVideos.length > 0 && visiblePreviewVideos.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">
                  כל הסרטונים בערוץ הזה חסומים.{' '}
                  <Link to="/hidden-videos" className="font-semibold text-amber-800 underline dark:text-amber-300">
                    ניהול סרטונים חסומים
                  </Link>
                </p>
              ) : activePreviewVideo ? (
                <>
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black pt-[56.25%] shadow-sm dark:border-zinc-700">
                    <div className="absolute inset-0 min-h-0">
                      <CleanPlayer
                        key={activePreviewVideo.videoId}
                        videoId={activePreviewVideo.videoId}
                        title={activePreviewVideo.title}
                        channelTitle={previewChannel.channel_name}
                        posterUrl={activePreviewVideo.thumbnail}
                        onPreviousTrack={goPrevManagerPreview}
                        onNextTrack={goNextManagerPreview}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                  <ParentChannelVideoSearch
                    id="parent-channel-video-search"
                    mode={previewSearchMode}
                    onModeChange={setPreviewSearchMode}
                    value={previewVideoSearch}
                    onChange={setPreviewVideoSearch}
                    channelTotalCount={baseVisiblePreviewCount}
                    channelFilteredCount={visiblePreviewVideos.length}
                    channelLabel={previewChannel.channel_name}
                    youtubeLoading={videoSearchLoading}
                    youtubeError={videoSearchError}
                    youtubeResults={videoSearchResults}
                    onYoutubeSearch={handleYoutubeVideoSearch}
                    youtubeResultsSlot={renderYoutubeSearchResults}
                    className="mb-3"
                  />
                  {hiddenVideoIds.size > 0 ? (
                    <p className="mb-2 text-xs">
                      <Link
                        to="/hidden-videos"
                        className="font-semibold text-amber-800 underline dark:text-amber-300"
                      >
                        {hiddenVideoIds.size} סרטונים חסומים — ניהול והחזרה
                      </Link>
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-base font-bold leading-snug text-slate-900 dark:text-zinc-100">
                      {activePreviewVideo.title}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                    {(deviceId || localParent.localAccessToken) && (
                      <HideVideoButton
                        deviceId={deviceId}
                        localAccessToken={localParent.localAccessToken}
                        verifyPin={verifyChannelParentPin}
                        action="hide"
                        compact
                        video={{
                          youtube_video_id: activePreviewVideo.videoId,
                          title: activePreviewVideo.title,
                          thumbnail_url: activePreviewVideo.thumbnail,
                          youtube_channel_id: previewChannel.youtube_channel_id,
                          channel_name: previewChannel.channel_name,
                        }}
                        onSuccess={() => handleHidden(activePreviewVideo.videoId)}
                      />
                    )}
                    {user?.id || localParent.localAccessToken ? (
                      <AddToPlaylistButton
                        mode={user?.id ? 'parent' : 'kid'}
                        userId={user?.id ? (ownerUserId ?? user.id) : null}
                        childAccessToken={user?.id ? null : localParent.localAccessToken}
                        compact
                        video={{
                          youtube_video_id: activePreviewVideo.videoId,
                          title: activePreviewVideo.title,
                          thumbnail_url: activePreviewVideo.thumbnail,
                          youtube_channel_id: previewChannel.youtube_channel_id,
                          channel_name: previewChannel.channel_name,
                        }}
                      />
                    ) : null}
                    </div>
                  </div>
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {visiblePreviewVideos.map((v) => {
                      const isCurrent = v.videoId === activePreviewVideo?.videoId
                      return (
                        <PreviewVideoCard
                          key={v.videoId}
                          video={v}
                          active={isCurrent}
                          onClick={handlePickPreviewVideo}
                          actionSlot={
                            <div className="flex shrink-0 flex-col gap-1">
                              {(deviceId || localParent.localAccessToken) && (
                                <HideVideoButton
                                  deviceId={deviceId}
                                  localAccessToken={localParent.localAccessToken}
                                  verifyPin={verifyChannelParentPin}
                                  action="hide"
                                  compact
                                  video={{
                                    youtube_video_id: v.videoId,
                                    title: v.title,
                                    thumbnail_url: v.thumbnail,
                                    youtube_channel_id: previewChannel.youtube_channel_id,
                                    channel_name: previewChannel.channel_name,
                                  }}
                                  onSuccess={() => handleHidden(v.videoId)}
                                />
                              )}
                              {user?.id || localParent.localAccessToken ? (
                                <AddToPlaylistButton
                                  mode={user?.id ? 'parent' : 'kid'}
                                  userId={user?.id ? (ownerUserId ?? user.id) : null}
                                  childAccessToken={user?.id ? null : localParent.localAccessToken}
                                  compact
                                  video={{
                                    youtube_video_id: v.videoId,
                                    title: v.title,
                                    thumbnail_url: v.thumbnail,
                                    youtube_channel_id: previewChannel.youtube_channel_id,
                                    channel_name: previewChannel.channel_name,
                                  }}
                                />
                              ) : null}
                            </div>
                          }
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

      <ParentalPinModal
        open={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false)
          pendingPinActionRef.current = null
        }}
        verifyPin={verifyChannelParentPin}
        onVerified={(pin) => runAfterVerifiedPin(pin.replace(/\D/g, '').trim())}
        title="אימות הורה"
        description="הזינו את קוד ההורה (4–6 ספרות). הקוד נבדק מול הפרופיל שלכם. רק אחרי אימות מוצלח תתבצע הפעולה (חיפוש / הוספת ערוץ / בקשת הסרה)."
      />

      <Modal
        open={addSuccessModalOpen}
        onClose={() => setAddSuccessModalOpen(false)}
        title="הערוץ נוסף בהצלחה! 🎉"
        bodyClassName="max-h-[70vh] overflow-y-auto text-right"
        footer={
          <div dir="rtl" className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-start">
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setAddSuccessModalOpen(false)}
            >
              הוספת ערוץ נוסף
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                setAddSuccessModalOpen(false)
                setSearchOpen(false)
                setAddedSearchChannelIds(new Set())
                navigate('/channels')
              }}
            >
              מעבר לערוצים שלי
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          האם תרצה להוסיף ערוצים נוספים או לעבור לרשימת הערוצים שלך?
        </p>
      </Modal>
    </div>
  )
}

function PreviewVideoCard({
  video,
  active,
  onClick,
  actionSlot,
}: {
  video: PreviewRow
  active: boolean
  onClick: (video: PreviewRow) => void
  actionSlot?: ReactNode
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
    <div
      className={`flex w-full items-center gap-2 rounded-lg p-1.5 transition ${
        active
          ? 'bg-slate-100 ring-1 ring-brand-500/40 dark:bg-zinc-800'
          : 'hover:bg-slate-50 dark:hover:bg-zinc-800/70'
      }`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-right pointer-events-auto"
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
      {actionSlot ? <div className="shrink-0">{actionSlot}</div> : null}
    </div>
  )
}
