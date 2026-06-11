import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Plus, X } from 'lucide-react'
import { CleanPlayer } from '../player/CleanPlayer'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import { QuickBlockButton } from '../channels/QuickBlockButton'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../youtube/YoutubeWatchVideoDetails'
import { YoutubeSuggestedList } from '../youtube/YoutubeSuggestedList'
import { usePlaylists } from '../../hooks/usePlaylists'
import { usePrefetchFirstUncachedStream } from '../../hooks/usePrefetchFirstUncachedStream'
import type { PlaylistVideo, UserPlaylist } from '../../lib/playlists'
import type { ParentPinVerifyResult } from '../../lib/verifyParentManagementPin'
import { cn } from '../../lib/utils'

export type ParentQuickBlockConfig = {
  enabled: boolean
  localAccessToken: string
  cachedPin?: string | null
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
}

type Props = {
  childAccessToken: string
  parentQuickBlock?: ParentQuickBlockConfig | null
}

export function KidPlaylistView({ childAccessToken, parentQuickBlock }: Props) {
  const { playlists, loading: playlistsLoading, createPlaylist, fetchVideos } = usePlaylists({
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

  const prefetchPlaylistVideoIds = useMemo(
    () => videos.map((v) => v.youtube_video_id),
    [videos]
  )
  usePrefetchFirstUncachedStream(prefetchPlaylistVideoIds)

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

  const handleSelectVideo = useCallback((videoId: string) => {
    setActiveVideoId(videoId)
  }, [])

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

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const { data, error } = await createPlaylist(name)
    setCreating(false)
    if (error) return
    setNewName('')
    setCreateOpen(false)
    if (data?.id) setSelectedId(data.id)
  }

  const cancelCreate = () => {
    if (creating) return
    setNewName('')
    setCreateOpen(false)
  }

  const active = videos.find((v) => v.youtube_video_id === activeVideoId) ?? null
  const activeIndex = videos.findIndex((v) => v.youtube_video_id === activeVideoId)
  const hasNextPlaylistVideo = activeIndex >= 0 && activeIndex < videos.length - 1

  const goNext = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= videos.length - 1) return
    setActiveVideoId(videos[activeIndex + 1].youtube_video_id)
  }, [videos, activeIndex])

  const goPrev = useCallback(() => {
    if (activeIndex <= 0) return
    setActiveVideoId(videos[activeIndex - 1].youtube_video_id)
  }, [videos, activeIndex])

  if (playlistsLoading && playlists.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 px-4">
        <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
        <span className="text-base font-semibold text-slate-700 dark:text-zinc-200">טוען פלייליסטים…</span>
      </div>
    )
  }

  if (playlists.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-12 text-center">
        <ListMusic className="h-16 w-16 text-brand-500 dark:text-brand-400" aria-hidden />
        <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-50">אין עדיין פלייליסטים</h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
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
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
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
      <div className="mb-3 flex flex-col gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-3 shadow-xl shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/25">
            <ListMusic className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-base font-bold text-slate-900 dark:text-zinc-50">הפלייליסטים שלי</p>
        </div>
        <Button
          type="button"
          className="min-h-11 rounded-2xl px-5 font-bold"
          onClick={() => setCreateOpen((open) => !open)}
        >
          <Plus className="h-5 w-5" aria-hidden />
          יצירת פלייליסט חדש
        </Button>
      </div>

      {createOpen ? (
        <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
          <label className="mb-2 block text-sm font-semibold text-zinc-200">שם הפלייליסט החדש</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="למשל: ילדים"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-12 max-w-sm flex-1 rounded-2xl"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
            />
            <Button type="button" className="min-h-12 rounded-2xl px-5 font-bold" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
              {creating ? <LoadingSpinner className="h-4 w-4" /> : null}
              שמור
            </Button>
            <Button type="button" variant="secondary" className="min-h-12 rounded-2xl px-5" onClick={cancelCreate} disabled={creating}>
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
              'shrink-0 rounded-2xl border px-4 py-2 text-sm font-semibold shadow-sm transition',
              selectedId === pl.id
                ? 'border-brand-500/70 bg-brand-950/50 text-brand-100 ring-1 ring-brand-500/20'
                : 'border-zinc-800 bg-zinc-950/70 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-900'
            )}
          >
            {pl.name}
            <span className="mr-1 text-xs opacity-70">({pl.video_count})</span>
          </button>
        ))}
      </div>

      {videosLoading && videos.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-3">
          <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
          <span className="font-semibold text-slate-700 dark:text-zinc-200">טוען סרטונים…</span>
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
      ) : videos.length === 0 ? (
        <div className="mx-auto max-w-lg px-4 py-12 text-center">
          <p className="text-sm text-slate-600 dark:text-zinc-400">
            {selected ? `"${selected.name}" ריק.` : 'בחרו פלייליסט.'} הוסיפו סרטונים מלשונית צפייה.
          </p>
        </div>
      ) : (
        <YoutubeWatchLayout
          main={
            active ? (
              <>
                <div className="relative w-full overflow-hidden rounded-none bg-black lg:rounded-none">
                  <div className="relative pt-[56.25%]">
                    <div className="absolute inset-0 min-h-0">
                      <CleanPlayer
                        videoId={active.youtube_video_id}
                        title={active.title}
                        channelTitle={active.channel_name ?? undefined}
                        posterUrl={active.thumbnail_url}
                        onNextTrack={goNext}
                        onPreviousTrack={goPrev}
                        hasNextTrack={hasNextPlaylistVideo}
                        className="h-full w-full"
                      />
                    </div>
                  </div>
                </div>
                <YoutubeWatchVideoDetails
                  title={active.title}
                  channelName={active.channel_name}
                  actions={
                    <AddToPlaylistButton
                      mode="kid"
                      userId={null}
                      childAccessToken={childAccessToken}
                      video={{
                        youtube_video_id: active.youtube_video_id,
                        title: active.title,
                        thumbnail_url: active.thumbnail_url,
                        youtube_channel_id: active.youtube_channel_id,
                        channel_name: active.channel_name,
                      }}
                      onAdded={() => selectedId && void loadVideos(selectedId)}
                    />
                  }
                />
              </>
            ) : null
          }
          sidebar={
            <YoutubeSuggestedList title="סדר הניגון">
              {videos.map((video) => {
                const isCurrent = video.youtube_video_id === activeVideoId
                return (
                  <li key={video.youtube_video_id} className="w-full">
                    <YoutubeVideoCard
                      layout="row"
                      title={video.title}
                      thumbnail={video.thumbnail_url}
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
                              setVideos((prev) =>
                                prev.filter((x) => x.youtube_video_id !== video.youtube_video_id)
                              )
                              if (activeVideoId === video.youtube_video_id) {
                                setActiveVideoId(null)
                              }
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
