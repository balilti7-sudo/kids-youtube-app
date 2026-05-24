import { useCallback, useEffect, useRef, useState } from 'react'
import { ListMusic, Plus } from 'lucide-react'
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
  forcePaused?: boolean
}

export function KidPlaylistView({ childAccessToken, parentQuickBlock, forcePaused = false }: Props) {
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
    if (data?.id) setSelectedId(data.id)
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
        <div className="flex w-full max-w-sm gap-2">
          <Input
            placeholder="שם הפלייליסט"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1"
          />
          <Button type="button" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
            {creating ? <LoadingSpinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />}
            צור
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1600px] px-1.5 pb-4 pt-2 sm:px-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 px-0.5">
        <ListMusic className="h-6 w-6 text-brand-600 dark:text-brand-400" aria-hidden />
        <p className="text-base font-bold text-slate-900 dark:text-zinc-50">הפלייליסטים שלי</p>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {playlists.map((pl: UserPlaylist) => (
          <button
            key={pl.id}
            type="button"
            onClick={() => setSelectedId(pl.id)}
            className={cn(
              'shrink-0 rounded-full border-2 px-4 py-2 text-sm font-semibold transition',
              selectedId === pl.id
                ? 'border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/50 dark:text-brand-100'
                : 'border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900'
            )}
          >
            {pl.name}
            <span className="mr-1 text-xs opacity-70">({pl.video_count})</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2 px-0.5">
        <Input
          placeholder="פלייליסט חדש"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="max-w-xs flex-1"
        />
        <Button type="button" variant="secondary" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          חדש
        </Button>
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
                        forcePaused={forcePaused}
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
