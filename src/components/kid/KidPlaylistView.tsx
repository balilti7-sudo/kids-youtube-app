import { useCallback, useEffect, useState } from 'react'
import { ListMusic, Play } from 'lucide-react'
import type { ChildPlaylistVideo } from '../../lib/childPlaylist'
import { CleanPlayer } from '../player/CleanPlayer'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { PlaylistToggleButton } from './PlaylistToggleButton'
import type { useChildPlaylist } from '../../hooks/useChildPlaylist'

type PlaylistApi = Pick<
  ReturnType<typeof useChildPlaylist>,
  'isInPlaylist' | 'toggle' | 'toggleBusyId'
>

type Props = {
  items: ChildPlaylistVideo[]
  loading: boolean
  playlistApi: PlaylistApi
}

export function KidPlaylistView({ items, loading, playlistApi }: Props) {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)

  const active = items.find((v) => v.youtube_video_id === activeVideoId) ?? null

  useEffect(() => {
    if (items.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) =>
      prev && items.some((v) => v.youtube_video_id === prev) ? prev : items[0].youtube_video_id
    )
  }, [items])

  const goNext = useCallback(() => {
    if (!activeVideoId) return
    const idx = items.findIndex((v) => v.youtube_video_id === activeVideoId)
    if (idx >= 0 && idx < items.length - 1) setActiveVideoId(items[idx + 1].youtube_video_id)
  }, [items, activeVideoId])

  const goPrev = useCallback(() => {
    if (!activeVideoId) return
    const idx = items.findIndex((v) => v.youtube_video_id === activeVideoId)
    if (idx > 0) setActiveVideoId(items[idx - 1].youtube_video_id)
  }, [items, activeVideoId])

  if (loading && items.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 px-4">
        <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
        <span className="text-base font-semibold text-slate-700 dark:text-zinc-200">טוען פלייליסט…</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-16 text-center">
        <ListMusic className="h-16 w-16 text-brand-500 dark:text-brand-400" aria-hidden />
        <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-50">הפלייליסט שלי ריק</h2>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          בלשונית <strong>צפייה</strong> בחרו ערוץ, ולחצו <strong>הוסף לפלייליסט</strong> על סרטונים שאתם אוהבים.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1600px] px-1.5 pb-4 pt-2 sm:px-3">
      <div className="mb-3 flex items-center gap-2 px-0.5">
        <ListMusic className="h-6 w-6 text-brand-600 dark:text-brand-400" aria-hidden />
        <p className="text-base font-bold text-slate-900 dark:text-zinc-50">
          {items.length} סרטונים בפלייליסט
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-0 lg:flex-row lg:gap-3">
        <div className="min-w-0 flex-1 lg:max-w-[min(100%,1280px)]">
          {active ? (
            <>
              <div className="relative w-full overflow-hidden rounded-none bg-black sm:rounded-xl">
                <div className="relative pt-[56.25%]">
                  <div className="absolute inset-0 min-h-0">
                    <CleanPlayer
                      key={active.youtube_video_id}
                      videoId={active.youtube_video_id}
                      title={active.title}
                      channelTitle={active.channel_name ?? undefined}
                      posterUrl={active.thumbnail_url}
                      onNextTrack={goNext}
                      onPreviousTrack={goPrev}
                      className="h-full w-full"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 px-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-base font-bold leading-snug text-slate-900 dark:text-zinc-50 sm:text-lg">
                    {active.title}
                  </h2>
                  {active.channel_name ? (
                    <p className="mt-1 text-sm text-slate-500 dark:text-zinc-500">{active.channel_name}</p>
                  ) : null}
                </div>
                <PlaylistToggleButton
                  inPlaylist
                  busy={playlistApi.toggleBusyId === active.youtube_video_id}
                  onToggle={playlistApi.toggle}
                  payload={{
                    youtube_video_id: active.youtube_video_id,
                    title: active.title,
                    thumbnail_url: active.thumbnail_url,
                    youtube_channel_id: active.youtube_channel_id,
                    channel_name: active.channel_name,
                  }}
                />
              </div>
            </>
          ) : null}
        </div>

        <aside className="mt-3 min-w-0 border-t border-black/[0.06] pt-3 dark:border-zinc-800 lg:mt-0 lg:w-[min(100%,400px)] lg:shrink-0 lg:border-t-0 lg:border-s lg:pt-0 lg:ps-3 dark:lg:border-zinc-800">
          <div className="mb-2 flex items-center gap-2">
            <Play className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" fill="currentColor" aria-hidden />
            <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">סדר הניגון</p>
          </div>
          <ul className="no-scrollbar flex gap-2 max-lg:flex-row max-lg:overflow-x-auto max-lg:pb-1 lg:flex-col lg:gap-1.5">
            {items.map((video) => {
              const isCurrent = video.youtube_video_id === activeVideoId
              return (
                <li key={video.youtube_video_id} className="max-lg:w-[124px] max-lg:shrink-0 lg:w-full">
                  <div
                    className={`flex w-full flex-col gap-2 rounded-xl p-2 transition max-lg:items-stretch lg:flex-row lg:items-start ${
                      isCurrent
                        ? 'bg-white shadow-md ring-2 ring-brand-500/50 dark:bg-zinc-900'
                        : 'bg-white/60 hover:bg-white dark:bg-zinc-900/50 dark:hover:bg-zinc-900/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveVideoId(video.youtube_video_id)}
                      className="flex min-w-0 flex-1 gap-2 text-right max-lg:flex-col lg:flex-row"
                    >
                      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-zinc-800 max-lg:max-h-[76px] lg:w-32 lg:min-w-[128px]">
                        {video.thumbnail_url ? (
                          <img
                            src={video.thumbnail_url}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                            וידאו
                          </div>
                        )}
                        {isCurrent ? (
                          <span className="absolute bottom-1 end-1 rounded bg-red-600 px-1 py-0.5 text-[10px] font-bold text-white">
                            מנגן
                          </span>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 flex-1 text-start text-xs font-semibold leading-snug text-slate-800 sm:text-sm dark:text-zinc-200">
                        {video.title}
                      </p>
                    </button>
                    <PlaylistToggleButton
                      compact
                      inPlaylist={playlistApi.isInPlaylist(video.youtube_video_id)}
                      busy={playlistApi.toggleBusyId === video.youtube_video_id}
                      onToggle={playlistApi.toggle}
                      payload={{
                        youtube_video_id: video.youtube_video_id,
                        title: video.title,
                        thumbnail_url: video.thumbnail_url,
                        youtube_channel_id: video.youtube_channel_id,
                        channel_name: video.channel_name,
                      }}
                      className="w-full max-lg:mx-auto lg:w-auto"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </div>
  )
}
