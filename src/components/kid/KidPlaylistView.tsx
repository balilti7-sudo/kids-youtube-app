import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import {
  PlaylistQueueHint,
  PlaylistQueueRow,
  type PlaylistBlockConfig,
} from '../playlists/PlaylistQueueRow'
import { PlaylistTabVideoSearch } from '../playlists/PlaylistTabVideoSearch'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../youtube/YoutubeWatchVideoDetails'
import { YoutubeSuggestedList } from '../youtube/YoutubeSuggestedList'
import { YoutubeLikeButton } from '../youtube/YoutubeLikeButton'
import { ChildWatchPlayerShell } from './ChildWatchPlayerShell'
import { usePlaylists, type PlaylistsClient } from '../../hooks/usePlaylists'
import type { PlaylistVideo, UserPlaylist } from '../../lib/playlists'
import type { ParentPinVerifyResult } from '../../lib/verifyParentManagementPin'
import { cn } from '../../lib/utils'
import { classifyWatchFormat, isShortsBlockedForProfile } from '../../lib/childContentSafety'
import { filterVideosRespectingAllowShorts } from '../../lib/videoFormatClassification'
import { buildShortsAwareNavQueue } from '../../lib/shortsNavQueue'
import { shouldHideFromChildBrowse } from '../../lib/liveStreamPolicy'
import { saveActivePlaylistId } from '../../lib/activePlaylistSelection'
import { scrollPlayerIntoViewForWatch } from '../../lib/scrollPlayerIntoView'
import {
  captureBrowseNavContext,
  restoreBrowseScroll,
  type BrowseNavContext,
} from '../../lib/watchPlayerNav'
import { usePlayerOwnedBackNavigation } from '../../hooks/usePlayerOwnedBackNavigation'
import { formatVideoDurationClock } from '../../lib/formatRelativeTime'
import { fetchVideoDetailsBatch } from '../../lib/youtube'
import { usePlaylistQueueHandlers } from '../../hooks/usePlaylistQueueHandlers'
import {
  appendPlaylistVideoIfMissing,
  PLAYLIST_VIDEO_ADDED_EVENT,
  type PlaylistVideoAddedDetail,
} from '../../lib/playlistEvents'

export type ParentQuickBlockConfig = {
  enabled: boolean
  localAccessToken: string
  cachedPin?: string | null
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
}

type Props = {
  childAccessToken: string
  allowShorts?: boolean
  hideThumbnails?: boolean
  parentQuickBlock?: ParentQuickBlockConfig | null
  initialPlaylistId?: string | null
  playlistClient?: PlaylistsClient
  /** Open a whitelisted channel inside SafeTube (never an external YouTube link). */
  onOpenChannel?: (youtubeChannelId: string) => void
}

export function KidPlaylistView({
  childAccessToken,
  allowShorts = true,
  hideThumbnails = false,
  parentQuickBlock,
  initialPlaylistId = null,
  playlistClient,
  onOpenChannel,
}: Props) {
  const localPlaylists = usePlaylists({
    mode: 'kid',
    userId: null,
    childAccessToken: playlistClient ? null : childAccessToken,
  })
  const playlistApi = playlistClient ?? localPlaylists
  const {
    playlists,
    loading: playlistsLoading,
    createPlaylist,
    fetchVideos,
    refresh,
    removeVideo,
    reorderVideos,
  } = playlistApi
  const [selectedId, setSelectedId] = useState<string | null>(initialPlaylistId)
  const [videos, setVideos] = useState<PlaylistVideo[]>([])
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({})
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const browseNavContextRef = useRef<BrowseNavContext | null>(null)
  /** True only after an explicit tap — auto-selected first playlist item does not own Back. */
  const [watchSessionActive, setWatchSessionActive] = useState(false)
  const playerAnchorRef = useRef<HTMLDivElement>(null)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const loadRequestRef = useRef(0)

  const blockConfig = useMemo((): PlaylistBlockConfig | null => {
    if (!parentQuickBlock?.enabled) return null
    return {
      enabled: true,
      localAccessToken: parentQuickBlock.localAccessToken,
      cachedPin: parentQuickBlock.cachedPin,
      verifyPin: parentQuickBlock.verifyPin,
    }
  }, [parentQuickBlock])

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    if (initialPlaylistId) setSelectedId(initialPlaylistId)
  }, [initialPlaylistId])

  useEffect(() => {
    if (playlists.length > 0 && !selectedId) {
      const first = playlists[0]!
      setSelectedId(first.id)
      saveActivePlaylistId(first.id, first.name)
    }
  }, [playlists, selectedId])

  const selectPlaylist = useCallback((pl: UserPlaylist) => {
    setSelectedId(pl.id)
    saveActivePlaylistId(pl.id, pl.name)
  }, [])

  const loadVideos = useCallback(
    async (playlistId: string) => {
      const requestId = ++loadRequestRef.current
      setVideosLoading(true)
      setVideosError(null)
      try {
        const { data, error } = await fetchVideos(playlistId)
        if (requestId !== loadRequestRef.current) return
        if (error) {
          setVideos([])
          setActiveVideoId(null)
          setVideosError(error.message)
          return
        }
        setVideos(data)
        setActiveVideoId((prev) =>
          prev && data.some((v) => v.youtube_video_id === prev)
            ? prev
            : data[0]?.youtube_video_id ?? null
        )
      } catch (e) {
        if (requestId !== loadRequestRef.current) return
        setVideos([])
        setActiveVideoId(null)
        setVideosError(e instanceof Error ? e.message : 'טעינת סרטונים נכשלה')
      } finally {
        if (requestId === loadRequestRef.current) {
          setVideosLoading(false)
        }
      }
    },
    [fetchVideos]
  )

  const queueHandlers = usePlaylistQueueHandlers({
    playlistId: selectedId,
    videos,
    setVideos,
    activeVideoId,
    setActiveVideoId,
    removeVideo,
    reorderVideos,
    onRefresh: () => void refresh(),
    reloadVideos: (id) => void loadVideos(id),
  })

  const handleBlocked = useCallback(
    (youtubeVideoId: string) => {
      setVideos((prev) => {
        const idx = prev.findIndex((v) => v.youtube_video_id === youtubeVideoId)
        const next = prev.filter((v) => v.youtube_video_id !== youtubeVideoId)
        setActiveVideoId((current) =>
          current === youtubeVideoId
            ? next[idx]?.youtube_video_id ?? next[idx - 1]?.youtube_video_id ?? null
            : current
        )
        return next
      })
      void refresh()
    },
    [refresh]
  )

  const visibleVideos = useMemo(
    () =>
      filterVideosRespectingAllowShorts(
        videos
          .filter((v) => !shouldHideFromChildBrowse(v.title, null))
          .map((v) => ({
            youtube_video_id: v.youtube_video_id,
            title: v.title,
            thumbnail_url: v.thumbnail_url,
            durationSeconds: null as number | null,
            format: classifyWatchFormat({
              youtubeVideoId: v.youtube_video_id,
              title: v.title,
              thumbnail: v.thumbnail_url,
            }),
            source: v,
          })),
        allowShorts
      ).map((row) => row.source),
    [videos, allowShorts]
  )

  const handleSelectVideo = useCallback(
    (videoId: string) => {
      const video = videos.find((v) => v.youtube_video_id === videoId)
      if (!video) {
        toast.error('סרטון זה אינו מאושר לצפייה')
        return
      }
      if (
        isShortsBlockedForProfile(allowShorts, {
          title: video.title,
          youtubeVideoId: video.youtube_video_id,
          thumbnail_url: video.thumbnail_url,
        })
      ) {
        toast.error('Shorts חסומים בפרופיל זה')
        return
      }
      if (shouldHideFromChildBrowse(video.title, null)) {
        toast.error('תוכן זה אינו זמין לצפייה')
        return
      }
      if (!watchSessionActive) {
        browseNavContextRef.current = captureBrowseNavContext({
          channelContentTab: 'playlists',
          priorActiveVideoId: null,
        })
        setWatchSessionActive(true)
      }
      setActiveVideoId(videoId)
      scrollPlayerIntoViewForWatch(playerAnchorRef.current)
    },
    [videos, allowShorts, watchSessionActive]
  )

  const exitWatchSession = useCallback(() => {
    const ctx = browseNavContextRef.current
    browseNavContextRef.current = null
    setWatchSessionActive(false)
    setActiveVideoId(null)
    if (ctx) restoreBrowseScroll(ctx.scrollY)
  }, [])

  const { handlePlayerBack } = usePlayerOwnedBackNavigation({
    enabled: true,
    isShortsOpen: false,
    isWatchOpen: watchSessionActive && Boolean(activeVideoId),
    onExitShorts: () => {},
    onExitWatch: exitWatchSession,
  })

  useEffect(() => {
    if (!selectedId) {
      setVideos([])
      setVideoDurations({})
      setActiveVideoId(null)
      setWatchSessionActive(false)
      browseNavContextRef.current = null
      setVideosError(null)
      setVideosLoading(false)
      return
    }
    void loadVideos(selectedId)
  }, [selectedId, loadVideos])

  useEffect(() => {
    const ids = videos
      .map((v) => v.youtube_video_id)
      .filter((id) => videoDurations[id] == null)
    if (ids.length === 0) return
    let cancelled = false
    void fetchVideoDetailsBatch(ids).then((details) => {
      if (cancelled) return
      setVideoDurations((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of ids) {
          if (next[id] != null) continue
          const sec = details.get(id)?.durationSeconds
          if (sec != null && sec > 0) {
            next[id] = sec
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    return () => {
      cancelled = true
    }
    // Only re-run when the playlist video id list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- videoDurations intentionally omitted
  }, [videos])

  useEffect(() => {
    if (!activeVideoId) return
    if (visibleVideos.some((v) => v.youtube_video_id === activeVideoId)) return
    setActiveVideoId(visibleVideos[0]?.youtube_video_id ?? null)
  }, [visibleVideos, activeVideoId])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const { data, error } = await createPlaylist(name)
    setCreating(false)
    if (error) {
      toast.error(error.message || 'יצירת הפלייליסט נכשלה')
      return
    }
    setNewName('')
    setCreateOpen(false)
    toast.success('הפלייליסט נוצר')
    if (data?.id) {
      setSelectedId(data.id)
      saveActivePlaylistId(data.id, name)
    }
  }

  const handlePlaylistMembershipChanged = useCallback(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onAdded = (event: Event) => {
      const detail = (event as CustomEvent<PlaylistVideoAddedDetail>).detail
      if (!detail?.video || !selectedId) return
      if (!detail.playlistIds.includes(selectedId)) return
      setVideos((prev) => appendPlaylistVideoIfMissing(prev, detail.video))
      void refresh()
    }
    window.addEventListener(PLAYLIST_VIDEO_ADDED_EVENT, onAdded)
    return () => window.removeEventListener(PLAYLIST_VIDEO_ADDED_EVENT, onAdded)
  }, [selectedId, refresh])

  const cancelCreate = () => {
    if (creating) return
    setNewName('')
    setCreateOpen(false)
  }

  const active = visibleVideos.find((v) => v.youtube_video_id === activeVideoId) ?? null
  const playerNavQueue = useMemo(() => {
    if (!active) return visibleVideos
    return buildShortsAwareNavQueue(
      visibleVideos.map((v) => ({
        ...v,
        format: classifyWatchFormat({
          youtubeVideoId: v.youtube_video_id,
          title: v.title,
          thumbnail: v.thumbnail_url,
        }),
      })),
      {
        ...active,
        format: classifyWatchFormat({
          youtubeVideoId: active.youtube_video_id,
          title: active.title,
          thumbnail: active.thumbnail_url,
        }),
      }
    )
  }, [visibleVideos, active])
  const activeIndex = playerNavQueue.findIndex((v) => v.youtube_video_id === activeVideoId)
  const hasNextPlaylistVideo = activeIndex >= 0 && activeIndex < playerNavQueue.length - 1

  const goNext = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= playerNavQueue.length - 1) return
    handleSelectVideo(playerNavQueue[activeIndex + 1]!.youtube_video_id)
  }, [playerNavQueue, activeIndex, handleSelectVideo])

  const goPrev = useCallback(() => {
    if (activeIndex <= 0) return
    handleSelectVideo(playerNavQueue[activeIndex - 1]!.youtube_video_id)
  }, [playerNavQueue, activeIndex, handleSelectVideo])

  if (playlistsLoading && playlists.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 px-4">
        <LoadingSpinner className="h-9 w-9 border-2 border-yt-red border-t-transparent" />
        <span className="text-base font-semibold text-yt-text">טוען פלייליסטים…</span>
      </div>
    )
  }

  if (playlists.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-12 text-center">
        <ListMusic className="h-16 w-16 text-yt-textMuted" aria-hidden />
        <h2 className="text-xl font-bold text-yt-text">אין עדיין פלייליסטים</h2>
        <p className="text-sm leading-relaxed text-yt-textMuted">
          צרו פלייליסט ראשון למטה, או הוסיפו סרטונים מלשונית <strong>צפייה</strong> עם ➕.
        </p>
        {!createOpen ? (
          <Button
            type="button"
            className="min-h-12 rounded-2xl px-5 font-bold"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-5 w-5" aria-hidden />
            יצירת פלייליסט חדש
          </Button>
        ) : (
          <div className="w-full max-w-sm rounded-2xl border border-yt-border bg-yt-surface p-3">
            <Input
              placeholder="שם הפלייליסט"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-12 rounded-2xl"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                className="min-h-11 flex-1 rounded-2xl font-bold"
                onClick={() => void handleCreate()}
                disabled={creating || !newName.trim()}
              >
                {creating ? <LoadingSpinner className="h-4 w-4" /> : null}
                שמור
              </Button>
              <Button type="button" variant="secondary" className="min-h-11 flex-1 rounded-2xl" onClick={cancelCreate} disabled={creating}>
                <X className="h-4 w-4" aria-hidden />
                ביטול
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1600px] px-1.5 pb-4 pt-2 sm:px-3">
      <div className="mb-3 flex flex-col gap-3 rounded-xl border border-yt-border bg-yt-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-yt-surfaceHover text-yt-text">
            <ListMusic className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-base font-bold text-yt-text">הפלייליסטים שלי</p>
        </div>
        <Button
          type="button"
          className="min-h-11 rounded-full px-5 font-bold"
          onClick={() => setCreateOpen((open) => !open)}
        >
          <Plus className="h-5 w-5" aria-hidden />
          יצירת פלייליסט חדש
        </Button>
      </div>

      <PlaylistTabVideoSearch
        className="mb-3"
        mode="kid"
        userId={null}
        childAccessToken={childAccessToken}
        initialPlaylists={playlists}
        preferredPlaylistId={selectedId}
        preferredPlaylistName={selected?.name ?? null}
        defaultExpanded={false}
      />

      {createOpen ? (
        <div className="mb-3 rounded-xl border border-yt-border bg-yt-surface p-3">
          <label className="mb-2 block text-sm font-semibold text-yt-text">שם הפלייליסט החדש</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="למשל: ילדים"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-12 max-w-sm flex-1 rounded-2xl"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <Button type="button" className="min-h-12 rounded-full px-5 font-bold" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating ? <LoadingSpinner className="h-4 w-4" /> : null}
              שמור
            </Button>
            <Button type="button" variant="secondary" className="min-h-12 rounded-full px-5" onClick={cancelCreate} disabled={creating}>
              <X className="h-4 w-4" aria-hidden />
              ביטול
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {playlists.map((pl: UserPlaylist) => (
          <button
            key={pl.id}
            type="button"
            onClick={() => selectPlaylist(pl)}
            className={cn(
              'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition',
              selectedId === pl.id
                ? 'border-yt-text bg-yt-text text-yt-bg'
                : 'border-yt-border bg-yt-surface text-yt-text hover:bg-yt-surfaceHover'
            )}
          >
            {pl.name}
            <span className="mr-1 text-xs opacity-70">({pl.video_count})</span>
          </button>
        ))}
      </div>

      {videosLoading && videos.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-3">
          <LoadingSpinner className="h-9 w-9 border-2 border-yt-red border-t-transparent" />
          <span className="font-semibold text-yt-text">טוען סרטונים…</span>
        </div>
      ) : videosError && videos.length === 0 ? (
        <div className="mx-auto max-w-lg px-4 py-12 text-center">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">{videosError}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => selectedId && void loadVideos(selectedId)}
          >
            נסו שוב
          </Button>
        </div>
      ) : visibleVideos.length === 0 ? (
        <div className="mx-auto max-w-lg px-4 py-12 text-center">
          <p className="text-sm text-yt-textMuted">
            {selected ? `"${selected.name}" ריק.` : 'בחרו פלייליסט.'} הוסיפו סרטונים מלשונית צפייה.
          </p>
        </div>
      ) : (
        <YoutubeWatchLayout
          main={
            active ? (
              <>
                <div ref={playerAnchorRef} className="scroll-mt-chrome w-full" data-safetube-player>
                  <ChildWatchPlayerShell
                    videoId={active.youtube_video_id}
                    title={active.title}
                    channelTitle={active.channel_name ?? undefined}
                    posterUrl={hideThumbnails ? null : active.thumbnail_url}
                    blankVideoFrame={hideThumbnails}
                    format={classifyWatchFormat({
                      youtubeVideoId: active.youtube_video_id,
                      title: active.title,
                      thumbnail: active.thumbnail_url,
                    })}
                    onNextTrack={goNext}
                    onPreviousTrack={goPrev}
                    hasNextTrack={hasNextPlaylistVideo}
                    onBack={handlePlayerBack}
                  />
                </div>
                <YoutubeWatchVideoDetails
                  title={active.title}
                  channelName={active.channel_name}
                  onChannelClick={
                    active.youtube_channel_id && onOpenChannel
                      ? () => onOpenChannel(active.youtube_channel_id!)
                      : undefined
                  }
                  hideImages={hideThumbnails}
                  subtitle="מאושר — SafeTube"
                  actions={
                    <>
                      <YoutubeLikeButton videoId={active.youtube_video_id} />
                      <AddToPlaylistButton
                        mode="kid"
                        userId={null}
                        childAccessToken={childAccessToken}
                        initialPlaylists={playlists}
                        variant="save"
                        video={{
                          youtube_video_id: active.youtube_video_id,
                          title: active.title,
                          thumbnail_url: active.thumbnail_url,
                          youtube_channel_id: active.youtube_channel_id,
                          channel_name: active.channel_name,
                        }}
                        onAdded={handlePlaylistMembershipChanged}
                      />
                    </>
                  }
                />
              </>
            ) : null
          }
          sidebar={
            <>
              <PlaylistQueueHint />
              <YoutubeSuggestedList title="סדר הניגון">
                {videos.map((video, index) => {
                  const isCurrent = video.youtube_video_id === activeVideoId
                  const isVisible = visibleVideos.some(
                    (v) => v.youtube_video_id === video.youtube_video_id
                  )
                  return (
                    <li key={video.youtube_video_id} className="w-full">
                      <PlaylistQueueRow
                        active={isCurrent}
                        index={index}
                        isFirst={index === 0}
                        isLast={index === videos.length - 1}
                        reordering={queueHandlers.reordering}
                        onSelect={() => handleSelectVideo(video.youtube_video_id)}
                        onRemove={() => queueHandlers.handleRemove(video.youtube_video_id)}
                        onMoveUp={() => queueHandlers.handleMoveUp(index)}
                        onMoveDown={() => queueHandlers.handleMoveDown(index)}
                        blockConfig={blockConfig}
                        blockVideo={{
                          youtube_video_id: video.youtube_video_id,
                          title: video.title,
                          thumbnail_url: video.thumbnail_url,
                          youtube_channel_id: video.youtube_channel_id,
                          channel_name: video.channel_name,
                        }}
                        onBlocked={() => handleBlocked(video.youtube_video_id)}
                        className={!isVisible ? 'opacity-60' : undefined}
                      >
                        <YoutubeVideoCard
                          layout="row"
                          title={video.title}
                          thumbnail={video.thumbnail_url}
                          hideThumbnail={hideThumbnails}
                          channelName={video.channel_name}
                          durationLabel={formatVideoDurationClock(videoDurations[video.youtube_video_id] ?? null)}
                          active={isCurrent}
                          playingLabel="מנגן"
                          actionSlot={
                            <AddToPlaylistButton
                              mode="kid"
                              userId={null}
                              childAccessToken={childAccessToken}
                              initialPlaylists={playlists}
                              compact
                              video={{
                                youtube_video_id: video.youtube_video_id,
                                title: video.title,
                                thumbnail_url: video.thumbnail_url,
                                youtube_channel_id: video.youtube_channel_id,
                                channel_name: video.channel_name,
                              }}
                              onAdded={handlePlaylistMembershipChanged}
                            />
                          }
                        />
                      </PlaylistQueueRow>
                    </li>
                  )
                })}
              </YoutubeSuggestedList>
            </>
          }
        />
      )}
    </div>
  )
}
