import { useCallback, useEffect, useRef, useState } from 'react'
import { ListMusic, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { usePlaylists } from '../hooks/usePlaylists'
import type { PlaylistVideo, UserPlaylist } from '../lib/playlists'
import { deletePlaylistForUser } from '../lib/playlists'
import { clearActivePlaylistIdIfMatches, getSavedActivePlaylistId, saveActivePlaylistId } from '../lib/activePlaylistSelection'
import { CleanPlayer } from '../components/player/CleanPlayer'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { AddToPlaylistButton } from '../components/playlists/AddToPlaylistButton'
import { QuickBlockButton } from '../components/channels/QuickBlockButton'
import { VideoThumbWithQuickBlock } from '../components/video/VideoThumbWithQuickBlock'
import { useHideVideoContext } from '../hooks/useHideVideoContext'
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

  const [selectedId, setSelectedId] = useState<string | null>(() => getSavedActivePlaylistId())
  const [videos, setVideos] = useState<PlaylistVideo[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const loadRequestRef = useRef(0)
  const hideVideoCtx = useHideVideoContext()

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
    if (playlists.length === 0) return
    const saved = getSavedActivePlaylistId()
    if (saved && playlists.some((p) => p.id === saved)) {
      if (selectedId !== saved) setSelectedId(saved)
      return
    }
    if (selectedId && !playlists.some((p) => p.id === selectedId)) {
      setSelectedId(null)
    }
  }, [playlists, selectedId])

  const selectPlaylist = useCallback((playlistId: string) => {
    setSelectedId(playlistId)
    saveActivePlaylistId(playlistId)
  }, [])

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
    setCreateOpen(false)
    await refresh()
    if (data?.id) selectPlaylist(data.id)
  }

  const cancelCreate = () => {
    if (creating) return
    setNewName('')
    setCreateOpen(false)
  }

  const handleDelete = async (pl: UserPlaylist) => {
    if (!window.confirm(`למחוק את "${pl.name}"?`)) return
    const { error } = await deletePlaylistForUser(pl.id)
    if (error) {
      toast.error(error.message)
      return
    }
    if (selectedId === pl.id) {
      clearActivePlaylistIdIfMatches(pl.id)
      setSelectedId(null)
    }
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
    <div className="mx-auto max-w-5xl px-3 pb-28 pt-4 sm:px-4">
      <section className="mb-4 rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/95 to-zinc-950 p-4 shadow-2xl shadow-black/20 ring-1 ring-zinc-900 sm:p-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/25">
                <ListMusic className="h-6 w-6" aria-hidden />
              </span>
              הפלייליסטים שלי
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
              צרו פלייליסטים ושמרו סרטונים מערוצים מאושרים. הילדים רואים את אותם הפלייליסטים במכשיר הצפייה.
            </p>
          </div>
          <Button
            type="button"
            className="min-h-12 rounded-2xl bg-zinc-100 px-5 font-bold text-zinc-950 shadow-lg shadow-black/25 hover:bg-white"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-5 w-5" aria-hidden />
            יצירת פלייליסט חדש
          </Button>
        </header>

        {createOpen ? (
          <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/25 p-3">
            <label className="mb-2 block text-sm font-semibold text-zinc-200">שם הפלייליסט החדש</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="למשל: ילדים"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-12 flex-1 rounded-2xl border-zinc-700 bg-zinc-900/90 text-zinc-50 focus:border-brand-400/70 focus:ring-brand-500/20"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && void handleCreate()}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="min-h-12 flex-1 rounded-2xl px-5 font-bold sm:flex-none"
                  onClick={() => void handleCreate()}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? <LoadingSpinner className="h-4 w-4" /> : null}
                  שמור
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-12 flex-1 rounded-2xl border-zinc-700 bg-zinc-900/70 px-5 text-zinc-100 hover:bg-zinc-800 sm:flex-none"
                  onClick={cancelCreate}
                  disabled={creating}
                >
                  <X className="h-4 w-4" aria-hidden />
                  ביטול
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {playlistsLoading && playlists.length === 0 ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : playlists.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/50 px-4 py-10 text-center">
          <ListMusic className="mx-auto mb-3 h-12 w-12 text-zinc-600" aria-hidden />
          <p className="text-sm font-semibold text-zinc-300">אין עדיין פלייליסטים</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
            לחצו על יצירת פלייליסט חדש והוסיפו אליו סרטונים מלשונית ערוצים.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ul className="flex shrink-0 flex-col gap-2 lg:w-64">
            {playlists.map((pl) => (
              <li key={pl.id} className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectPlaylist(pl.id)}
                  className={cn(
                    'min-w-0 flex-1 rounded-2xl border px-4 py-3 text-right shadow-sm transition',
                    selectedId === pl.id
                      ? 'border-brand-500/70 bg-brand-950/40 ring-1 ring-brand-500/20'
                      : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700 hover:bg-zinc-900'
                  )}
                >
                  <span className="block truncate font-bold text-zinc-100">{pl.name}</span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {pl.video_count} סרטונים
                    {selectedId === pl.id ? ' · פלייליסט פעיל' : ''}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`מחק ${pl.name}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 text-zinc-500 transition hover:border-red-500/50 hover:bg-red-950/40 hover:text-red-300"
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
                      <div
                        className={cn(
                          'flex w-full gap-2 rounded-lg p-2 text-right',
                          v.youtube_video_id === activeVideoId
                            ? 'bg-brand-50 ring-1 ring-brand-400 dark:bg-brand-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-zinc-800/60'
                        )}
                      >
                        <VideoThumbWithQuickBlock
                          thumbnailUrl={v.thumbnail_url}
                          className="h-12 w-20 rounded"
                          onClick={() => setActiveVideoId(v.youtube_video_id)}
                          quickBlock={
                            hideVideoCtx.canQuickBlock ? (
                              <QuickBlockButton
                                video={{
                                  youtube_video_id: v.youtube_video_id,
                                  title: v.title,
                                  thumbnail_url: v.thumbnail_url,
                                  youtube_channel_id: v.youtube_channel_id,
                                  channel_name: v.channel_name,
                                }}
                                deviceId={hideVideoCtx.deviceId}
                                localAccessToken={hideVideoCtx.localAccessToken}
                                cachedPin={hideVideoCtx.cachedPin}
                                verifyPin={hideVideoCtx.verifyPin}
                              />
                            ) : null
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setActiveVideoId(v.youtube_video_id)}
                          className="min-w-0 flex-1 text-right"
                        >
                          <span className="line-clamp-2 text-xs font-medium">{v.title}</span>
                        </button>
                      </div>
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
