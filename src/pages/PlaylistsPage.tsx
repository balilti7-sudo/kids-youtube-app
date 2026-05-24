import { useCallback, useEffect, useRef, useState } from 'react'
import { ListMusic, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { usePlaylists } from '../hooks/usePlaylists'
import type { PlaylistVideo, UserPlaylist } from '../lib/playlists'
import { deletePlaylistForUser } from '../lib/playlists'
import { CleanPlayer } from '../components/player/CleanPlayer'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { AddToPlaylistButton } from '../components/playlists/AddToPlaylistButton'
import { cn } from '../lib/utils'
import { toast } from 'sonner'

export function PlaylistsPage() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const userId = ownerUserId ?? user?.id ?? null
  const { playlists, loading: playlistsLoading, createPlaylist, fetchVideos, refresh } = usePlaylists({
    mode: 'parent',
    userId,
    childAccessToken: null,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [videos, setVideos] = useState<PlaylistVideo[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const loadRequestRef = useRef(0)

  const selected = playlists.find((p) => p.id === selectedId) ?? null

  const loadVideos = useCallback(
    async (playlistId: string) => {
      const requestId = ++loadRequestRef.current
      setVideosLoading(true)
      try {
        const { data, error } = await fetchVideos(playlistId)
        if (requestId !== loadRequestRef.current) return
        if (error) {
          toast.error(error.message)
          setVideos([])
          setActiveVideoId(null)
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
        toast.error(e instanceof Error ? e.message : 'טעינת סרטונים נכשלה')
        setVideos([])
        setActiveVideoId(null)
      } finally {
        if (requestId === loadRequestRef.current) {
          setVideosLoading(false)
        }
      }
    },
    [fetchVideos]
  )

  useEffect(() => {
    if (!selectedId) {
      setVideos([])
      setActiveVideoId(null)
      setVideosLoading(false)
      return
    }
    setVideos([])
    setActiveVideoId(null)
    void loadVideos(selectedId)
  }, [selectedId, loadVideos])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || !userId) return
    setCreating(true)
    const { data, error } = await createPlaylist(name)
    setCreating(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setNewName('')
    await refresh()
    if (data?.id) setSelectedId(data.id)
  }

  const handleDelete = async (pl: UserPlaylist) => {
    if (!window.confirm(`למחוק את "${pl.name}"?`)) return
    const { error } = await deletePlaylistForUser(pl.id)
    if (error) {
      toast.error(error.message)
      return
    }
    if (selectedId === pl.id) setSelectedId(null)
    await refresh()
  }

  const active = videos.find((v) => v.youtube_video_id === activeVideoId) ?? null
  const activeIndex = videos.findIndex((v) => v.youtube_video_id === activeVideoId)
  const hasNext = activeIndex >= 0 && activeIndex < videos.length - 1

  const goNext = () => {
    if (activeIndex < 0 || activeIndex >= videos.length - 1) return
    setActiveVideoId(videos[activeIndex + 1].youtube_video_id)
  }

  const goPrev = () => {
    if (activeIndex <= 0) return
    setActiveVideoId(videos[activeIndex - 1].youtube_video_id)
  }

  if (!userId) {
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-600 dark:text-zinc-400">
        התחברו כדי לנהל פלייליסטים.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-3 pb-28 pt-4 sm:px-4">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-zinc-50">
          <ListMusic className="h-7 w-7 text-brand-600" aria-hidden />
          הפלייליסטים שלי
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
          צרו פלייליסטים ושמרו סרטונים מערוצים מאושרים. הילדים רואים את אותם הפלייליסטים במכשיר הצפייה.
        </p>
      </header>

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="שם פלייליסט חדש"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1"
        />
        <Button type="button" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
          {creating ? <LoadingSpinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />}
          חדש
        </Button>
      </div>

      {playlistsLoading && playlists.length === 0 ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : playlists.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-600 dark:border-zinc-700 dark:text-zinc-400">
          אין עדיין פלייליסטים. צרו אחד למעלה, או הוסיפו סרטונים מלשונית ערוצים עם כפתור ➕.
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ul className="flex shrink-0 flex-col gap-2 lg:w-56">
            {playlists.map((pl) => (
              <li key={pl.id} className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(pl.id)}
                  className={cn(
                    'min-w-0 flex-1 rounded-xl border-2 px-3 py-2.5 text-right transition',
                    selectedId === pl.id
                      ? 'border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900'
                  )}
                >
                  <span className="block truncate font-semibold text-slate-900 dark:text-zinc-100">{pl.name}</span>
                  <span className="text-xs text-slate-500">{pl.video_count} סרטונים</span>
                </button>
                <button
                  type="button"
                  aria-label={`מחק ${pl.name}`}
                  className="rounded-xl border border-slate-200 px-2 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:border-zinc-700 dark:hover:bg-red-950/40"
                  onClick={() => void handleDelete(pl)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          <div className="min-w-0 flex-1">
            {!selected ? (
              <p className="text-sm text-slate-500">בחרו פלייליסט מהרשימה.</p>
            ) : videosLoading ? (
              <div className="flex items-center gap-2 py-12">
                <LoadingSpinner className="h-8 w-8 border-2 border-brand-500 border-t-transparent" />
                <span className="text-sm">טוען סרטונים…</span>
              </div>
            ) : videos.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-zinc-400">
                &quot;{selected.name}&quot; ריק. הוסיפו סרטונים מערוצים עם ➕ הוסף לפלייליסט.
              </p>
            ) : active ? (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-xl bg-black pt-[56.25%]">
                  <div className="absolute inset-0">
                    <CleanPlayer
                      key={active.youtube_video_id}
                      videoId={active.youtube_video_id}
                      title={active.title}
                      channelTitle={active.channel_name ?? undefined}
                      posterUrl={active.thumbnail_url}
                      onNextTrack={goNext}
                      onPreviousTrack={goPrev}
                      hasNextTrack={hasNext}
                      className="h-full w-full"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-zinc-50">{active.title}</h2>
                  <AddToPlaylistButton
                    mode="parent"
                    userId={userId}
                    childAccessToken={null}
                    video={{
                      youtube_video_id: active.youtube_video_id,
                      title: active.title,
                      thumbnail_url: active.thumbnail_url,
                      youtube_channel_id: active.youtube_channel_id,
                      channel_name: active.channel_name,
                    }}
                    compact
                    onAdded={() => void loadVideos(selected.id)}
                  />
                </div>
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {videos.map((v) => (
                    <li key={v.youtube_video_id}>
                      <button
                        type="button"
                        onClick={() => setActiveVideoId(v.youtube_video_id)}
                        className={cn(
                          'flex w-full gap-2 rounded-lg p-2 text-right',
                          v.youtube_video_id === activeVideoId
                            ? 'bg-brand-50 ring-1 ring-brand-400 dark:bg-brand-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'
                        )}
                      >
                        {v.thumbnail_url ? (
                          <img src={v.thumbnail_url} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                        ) : null}
                        <span className="line-clamp-2 text-xs font-medium">{v.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
