import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import { QuickBlockButton } from '../channels/QuickBlockButton'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../youtube/YoutubeWatchVideoDetails'
import { YoutubeSuggestedList } from '../youtube/YoutubeSuggestedList'
import { YoutubeLikeButton } from '../youtube/YoutubeLikeButton'
import { ChildWatchPlayerShell } from './ChildWatchPlayerShell'
import { usePlaylists } from '../../hooks/usePlaylists'
import type { PlaylistVideo, UserPlaylist } from '../../lib/playlists'
import type { ParentPinVerifyResult } from '../../lib/verifyParentManagementPin'
import { cn } from '../../lib/utils'
import { classifyWatchFormat, isShortsBlockedForProfile } from '../../lib/childContentSafety'
import { filterVideosRespectingAllowShorts } from '../../lib/videoFormatClassification'
import { buildShortsAwareNavQueue } from '../../lib/shortsNavQueue'
import { shouldHideFromChildBrowse } from '../../lib/liveStreamPolicy'

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
}

export function KidPlaylistView({
  childAccessToken,
  allowShorts = false,
  hideThumbnails = false,
  parentQuickBlock,
}: Props) {
  const { playlists, loading: playlistsLoading, createPlaylist, fetchVideos, refresh } = usePlaylists({
    mode: 'kid',
    userId: null,
    childAccessToken,
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [videos, setVideos] = useState<PlaylistVideo[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const loadRequestRef = useRef(0)

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  useEffect(() => {
    if (playlists.length > 0 && !selectedId) {
      setSelectedId(playlists[0].id)
    }
  }, [playlists, selectedId])

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
      setActiveVideoId(videoId)
    },
    [videos, allowShorts]
  )

  useEffect(() => {
    if (!selectedId) {
      setVideos([])
      setActiveVideoId(null)
      setVideosError(null)
      setVideosLoading(false)
      return
    }
    setVideos([])
    setActiveVideoId(null)
    void loadVideos(selectedId)
  }, [selectedId, loadVideos])

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
    if (data?.id) setSelectedId(data.id)
  }

  const handlePlaylistMembershipChanged = useCallback(() => {
    if (selectedId) void loadVideos(selectedId)
    void refresh()
  }, [selectedId, loadVideos, refresh])

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
            onClick={() => setSelectedId(pl.id)}
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
                />
                <YoutubeWatchVideoDetails
                  title={active.title}
                  channelName={active.channel_name}
                  subtitle="מאושר — SafeTube"
                  actions={
                    <>
                      <YoutubeLikeButton videoId={active.youtube_video_id} />
                      <AddToPlaylistButton
                        mode="kid"
                        userId={null}
                        childAccessToken={childAccessToken}
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
            <YoutubeSuggestedList title="סדר הניגון">
              {visibleVideos.map((video, index) => {
                const isCurrent = video.youtube_video_id === activeVideoId
                return (
                  <li key={video.youtube_video_id} className="w-full">
                    <YoutubeVideoCard
                      layout="row"
                      title={video.title}
                      thumbnail={video.thumbnail_url}
                      hideThumbnail={hideThumbnails}
                      channelName={video.channel_name}
                      active={isCurrent}
                      playingLabel="מנגן"
                      onClick={() => handleSelectVideo(video.youtube_video_id)}
                      thumbnailAction={
                        parentQuickBlock?.enabled ? (
                          <QuickBlockButton
                            video={{
                              youtube_video_id: video.youtube_video_id,
                              title: video.title,
                              thumbnail_url: video.thumbnail_url,
                              youtube_channel_id: video.youtube_channel_id,
                              channel_name: video.channel_name,
                            }}
                            localAccessToken={parentQuickBlock.localAccessToken}
                            cachedPin={parentQuickBlock.cachedPin}
                            verifyPin={parentQuickBlock.verifyPin}
                            onSuccess={() => {
                              const nextId =
                                activeVideoId === video.youtube_video_id
                                  ? visibleVideos[index + 1]?.youtube_video_id ??
                                    visibleVideos[index - 1]?.youtube_video_id ??
                                    null
                                  : activeVideoId
                              setVideos((prev) =>
                                prev.filter((x) => x.youtube_video_id !== video.youtube_video_id)
                              )
                              if (activeVideoId === video.youtube_video_id) {
                                setActiveVideoId(nextId)
                              }
                              void refresh()
                            }}
                          />
                        ) : null
                      }
                      actionSlot={
                        <AddToPlaylistButton
                          mode="kid"
                          userId={null}
                          childAccessToken={childAccessToken}
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
                  </li>
                )
              })}
            </YoutubeSuggestedList>
          }
        />
      )}
    </div>
  )
}
