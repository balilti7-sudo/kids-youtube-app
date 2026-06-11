import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
import { supabase } from '../../lib/supabase'
import { WhitelistView } from './WhitelistView'
import { ChannelSearch } from './ChannelSearch'
import { RemoveChannelModal } from './RemoveChannelModal'
import { CleanPlayer } from '../player/CleanPlayer'
import { Button } from '../ui/Button'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { toast } from 'sonner'
import { Skeleton } from '../ui/Skeleton'
import { Modal } from '../ui/Modal'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import { QuickBlockButton } from './QuickBlockButton'
import { useHideVideoContext } from '../../hooks/useHideVideoContext'
import { ChannelManagerVideoSearch } from './ChannelManagerVideoSearch'
import {
  CHANNEL_MANAGER_SEARCH_CONTROL_CLASS,
  CHANNEL_MANAGER_SEARCH_SHELL_CLASS,
} from './channelManagerSearchStyles'
import { ChannelVideoSearchBar } from '../kid/ChannelVideoSearchBar'
import { YoutubeWatchLayout } from '../youtube/YoutubeWatchLayout'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeWatchVideoDetails } from '../youtube/YoutubeWatchVideoDetails'
import { YoutubeSuggestedList } from '../youtube/YoutubeSuggestedList'
import { filterVideosByTitle } from '../../lib/filterVideosByTitle'
import { listHiddenVideoIdsForDevice, listHiddenVideoIdsLocalParent } from '../../lib/hiddenVideos'
import { isParentalManagementGateUnlocked } from '../../lib/parentalManagementGateStorage'

type PreviewRow = { videoId: string; title: string; thumbnail: string | null }

type PendingPinAction =
  | { kind: 'openSearch' }
  | { kind: 'add'; channel: YouTubeChannelResult }
  | { kind: 'remove'; channel: WhitelistedChannel }

type ChannelManagerProps = {
  managedDeviceId?: string | null
  embedded?: boolean
}

export function ChannelManager({ managedDeviceId = null, embedded = false }: ChannelManagerProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const hideVideoCtx = useHideVideoContext()
  const localParentPinForRpcRef = useRef<string | null>(null)
  const getLocalParentPin = useCallback(() => localParentPinForRpcRef.current, [])
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addedSearchChannelIds, setAddedSearchChannelIds] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [addSuccessModalOpen, setAddSuccessModalOpen] = useState(false)
  const [previewChannel, setPreviewChannel] = useState<WhitelistedChannel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVideos, setPreviewVideos] = useState<PreviewRow[]>([])
  const [activePreviewVideoId, setActivePreviewVideoId] = useState<string | null>(null)
  const [previewVideoSearch, setPreviewVideoSearch] = useState('')
  const [hiddenVideoIds, setHiddenVideoIds] = useState<Set<string>>(new Set())
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const requestedDeviceId = managedDeviceId ?? searchParams.get('device')

  const pendingPinActionRef = useRef<PendingPinAction | null>(null)

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    search,
    loadWhitelist,
    addToWhitelist,
    removeFromWhitelist,
  } = useChannels(deviceId ?? undefined, user?.id ?? ownerUserId, {
    localAccessToken: localParent.isActive ? localParent.localAccessToken : null,
    getLocalParentPin: localParent.isActive ? getLocalParentPin : undefined,
  })

  useEffect(() => {
    if (devices.length === 0) return
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      if (deviceId !== requestedDeviceId) setDeviceId(requestedDeviceId)
      return
    }
    if (!deviceId || !devices.some((d) => d.id === deviceId)) {
      setDeviceId(devices[0].id)
    }
  }, [devices, deviceId, requestedDeviceId])

  const handleDeviceChange = useCallback(
    (nextDeviceId: string) => {
      setDeviceId(nextDeviceId)
      if (!embedded) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('device', nextDeviceId)
            return next
          },
          { replace: true }
        )
      }
    },
    [embedded, setSearchParams]
  )

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
      const { error } = await addToWhitelist(c, null)
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
    if (embedded && isParentalManagementGateUnlocked()) {
      setSearchOpen(true)
      return
    }
    beginPinGate({ kind: 'openSearch' })
  }

  const requestAddChannel = (c: YouTubeChannelResult) => {
    if (embedded && isParentalManagementGateUnlocked()) {
      void handleAdd(c)
      return
    }
    beginPinGate({ kind: 'add', channel: c })
  }

  const requestRemoveChannel = (c: WhitelistedChannel) => {
    if (embedded && isParentalManagementGateUnlocked()) {
      setRemoveTarget(c)
      return
    }
    beginPinGate({ kind: 'remove', channel: c })
  }

  useEffect(() => {
    const channel = previewChannel
    if (!channel) {
      setPreviewLoading(false)
      setPreviewError(null)
      setPreviewVideos([])
      setActivePreviewVideoId(null)
      setPreviewVideoSearch('')
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
    () => filterVideosByTitle(previewVideos, previewVideoSearch),
    [previewVideos, previewVideoSearch]
  )

  const baseVisiblePreviewCount = useMemo(
    () => previewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)).length,
    [previewVideos, hiddenVideoIds]
  )

  /** Visible to parent in channel preview; hidden videos are omitted from this playback list. */
  const visiblePreviewVideos = useMemo(
    () => filteredPreviewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)),
    [filteredPreviewVideos, hiddenVideoIds]
  )

  const activePreviewVideo = useMemo(() => {
    if (!activePreviewVideoId) return null
    const video = previewVideos.find((v) => v.videoId === activePreviewVideoId)
    if (!video || hiddenVideoIds.has(video.videoId)) return null
    return video
  }, [previewVideos, activePreviewVideoId, hiddenVideoIds])

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

  const previewActiveIndex = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
  const hasNextPreviewVideo =
    previewActiveIndex >= 0 && previewActiveIndex < visiblePreviewVideos.length - 1

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

  const handlePickPreviewVideo = useCallback((videoId: string) => {
    setActivePreviewVideoId(videoId)
  }, [])

  return (
    <div className={embedded ? 'flex w-full flex-col gap-2 pb-1' : 'mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3'}>
      <header className="flex flex-col gap-1.5">
        {!embedded ? (
          <>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ניהול ערוצים</h1>
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
              פתיחת חיפוש ערוץ, הוספת ערוץ או הסרת ערוץ דורשים הזנת קוד ההורה מהחשבון.
            </p>
          </>
        ) : null}
        {selectedDevice ? (
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            המכשיר הפעיל כעת: <span className="font-semibold text-slate-700 dark:text-zinc-200">{selectedDevice.name}</span>
          </p>
        ) : null}
        {!embedded && devices.length > 1 ? (
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={deviceId ?? ''}
            onChange={(e) => handleDeviceChange(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className={CHANNEL_MANAGER_SEARCH_SHELL_CLASS}>
          <Button
            type="button"
            className={CHANNEL_MANAGER_SEARCH_CONTROL_CLASS}
            onClick={requestOpenChannelSearch}
          >
            חיפוש ערוץ
          </Button>
        </div>
        {user?.id || ownerUserId || localParent.localAccessToken ? (
          <ChannelManagerVideoSearch
            userId={user?.id ? (ownerUserId ?? user.id) : null}
            childAccessToken={user?.id ? null : localParent.localAccessToken}
            mode={user?.id ? 'parent' : 'kid'}
          />
        ) : null}
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
                <p className="text-sm text-slate-600 dark:text-zinc-400">אין סרטונים זמינים להצגה בערוץ הזה.</p>
              ) : activePreviewVideo ? (
                <YoutubeWatchLayout
                  className="mt-2"
                  main={
                    <>
                      <div className="relative w-full overflow-hidden rounded-none bg-black lg:rounded-none">
                        <div className="relative pt-[56.25%]">
                          <div className="absolute inset-0 min-h-0">
                            <CleanPlayer
                              videoId={activePreviewVideo.videoId}
                              title={activePreviewVideo.title}
                              channelTitle={previewChannel.channel_name}
                              posterUrl={activePreviewVideo.thumbnail}
                              onPreviousTrack={goPrevManagerPreview}
                              onNextTrack={goNextManagerPreview}
                              hasNextTrack={hasNextPreviewVideo}
                              className="h-full w-full"
                            />
                          </div>
                        </div>
                      </div>
                      <YoutubeWatchVideoDetails
                        title={activePreviewVideo.title}
                        channelName={previewChannel.channel_name}
                        actions={
                          <>
                            <div className="flex flex-wrap gap-2">
                              {hideVideoCtx.canQuickBlock ? (
                                <QuickBlockButton
                                  video={{
                                    youtube_video_id: activePreviewVideo.videoId,
                                    title: activePreviewVideo.title,
                                    thumbnail_url: activePreviewVideo.thumbnail,
                                    youtube_channel_id: previewChannel.youtube_channel_id,
                                    channel_name: previewChannel.channel_name,
                                  }}
                                  deviceId={hideVideoCtx.deviceId}
                                  localAccessToken={hideVideoCtx.localAccessToken}
                                  cachedPin={hideVideoCtx.cachedPin}
                                  verifyPin={hideVideoCtx.verifyPin}
                                  onSuccess={() => handleHidden(activePreviewVideo.videoId)}
                                />
                              ) : null}
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
                          </>
                        }
                      />
                    </>
                  }
                  sidebar={
                    <>
                      <ChannelVideoSearchBar
                        id="parent-channel-video-search"
                        value={previewVideoSearch}
                        onChange={setPreviewVideoSearch}
                        totalCount={baseVisiblePreviewCount}
                        filteredCount={visiblePreviewVideos.length}
                        channelLabel={previewChannel.channel_name}
                        className="mb-3"
                      />
                      <YoutubeSuggestedList title="סרטונים מומלצים">
                        {visiblePreviewVideos.map((v) => {
                          const isCurrent = v.videoId === activePreviewVideoId
                          return (
                            <li key={v.videoId} className="w-full">
                              <YoutubeVideoCard
                                layout="row"
                                title={v.title}
                                thumbnail={v.thumbnail}
                                active={isCurrent}
                                playingLabel="מנגן"
                                onClick={() => handlePickPreviewVideo(v.videoId)}
                                thumbnailAction={
                                  hideVideoCtx.canQuickBlock ? (
                                    <QuickBlockButton
                                      video={{
                                        youtube_video_id: v.videoId,
                                        title: v.title,
                                        thumbnail_url: v.thumbnail,
                                        youtube_channel_id: previewChannel.youtube_channel_id,
                                        channel_name: previewChannel.channel_name,
                                      }}
                                      deviceId={hideVideoCtx.deviceId}
                                      localAccessToken={hideVideoCtx.localAccessToken}
                                      cachedPin={hideVideoCtx.cachedPin}
                                      verifyPin={hideVideoCtx.verifyPin}
                                      onSuccess={() => handleHidden(v.videoId)}
                                    />
                                  ) : null
                                }
                                actionSlot={
                                  user?.id || localParent.localAccessToken ? (
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
                                  ) : null
                                }
                              />
                            </li>
                          )
                        })}
                      </YoutubeSuggestedList>
                      {visiblePreviewVideos.length === 0 ? (
                        <p className="py-6 text-center text-sm text-yt-textMuted">
                          {previewVideoSearch.trim()
                            ? 'אין סרטונים שמתאימים לחיפוש.'
                            : 'אין סרטונים.'}
                        </p>
                      ) : null}
                    </>
                  }
                />
              ) : (
                <p className="text-sm text-slate-600 dark:text-zinc-400">אין סרטונים במטמון לערוץ זה.</p>
              )}
            </section>
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
        description="הזינו את קוד ההורה בן 6 הספרות. לאחר מילוי כל הספרות האימות והפעולה יתבצעו אוטומטית."
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
                if (embedded) {
                  setPreviewChannel(null)
                  return
                }
                navigate('/dashboard')
              }}
            >
              {embedded ? 'סיום' : 'חזרה לבקרת הורים'}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">
          האם תרצה להוסיף ערוצים נוספים או לחזור לבקרת ההורים?
        </p>
      </Modal>
    </div>
  )
}
