import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, ListMusic, Plus, Tv } from 'lucide-react'
import { useChannels } from '../hooks/useChannels'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { CleanPlayer } from '../components/player/CleanPlayer'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { YoutubeSuggestedList } from '../components/youtube/YoutubeSuggestedList'
import { YoutubeVideoCard } from '../components/youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import { buildDiverseVideoMix } from '../lib/buildDiverseVideoMix'
import { supabase } from '../lib/supabase'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../lib/activeDeviceSelection'

type ChannelVideoRow = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
}

type DiscoveryVideo = ChannelVideoRow & {
  channelId: string
  youtubeChannelId: string
  channelName: string
}

const CHILD_PERSONAL_PLAYLIST_KEY = 'safetube_child_personal_playlist_v1'

function readChildPlaylistStorage(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(CHILD_PERSONAL_PLAYLIST_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string[]> = {}
    for (const [deviceId, ids] of Object.entries(parsed)) {
      if (!Array.isArray(ids)) continue
      out[deviceId] = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    }
    return out
  } catch {
    return {}
  }
}

function getSavedPlaylistIds(deviceId: string | null): Set<string> {
  if (!deviceId) return new Set()
  return new Set(readChildPlaylistStorage()[deviceId] ?? [])
}

function savePlaylistIds(deviceId: string, ids: Set<string>) {
  try {
    const all = readChildPlaylistStorage()
    all[deviceId] = Array.from(ids)
    localStorage.setItem(CHILD_PERSONAL_PLAYLIST_KEY, JSON.stringify(all))
  } catch {
    /* ignore localStorage failures */
  }
}

export function ChannelsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devicesLoading } = useDevices(ownerUserId)
  const requestedDeviceId = searchParams.get('device') ?? getSavedActiveChildProfileId()
  const requestedChannelId = searchParams.get('channel')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [videos, setVideos] = useState<ChannelVideoRow[]>([])
  const [discoveryVideos, setDiscoveryVideos] = useState<DiscoveryVideo[]>([])
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [videoSearch, setVideoSearch] = useState('')
  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Set<string>>(new Set())
  const [showMyPlaylist, setShowMyPlaylist] = useState(false)

  useEffect(() => {
    if (devices.length === 0) return
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      setDeviceId(requestedDeviceId)
      saveActiveChildProfileId(requestedDeviceId)
      return
    }
    setDeviceId((current) => {
      const next = current && devices.some((d) => d.id === current) ? current : devices[0].id
      if (next) saveActiveChildProfileId(next)
      return next
    })
  }, [devices, requestedDeviceId])

  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const { whitelist, loading } = useChannels(deviceId ?? undefined, ownerUserId)

  useEffect(() => {
    setSavedPlaylistIds(getSavedPlaylistIds(deviceId))
    setShowMyPlaylist(false)
  }, [deviceId])

  const visibleChannels = useMemo(() => whitelist.filter((c) => c.youtube_channel_id), [whitelist])
  const selectedChannel = useMemo(
    () =>
      visibleChannels.find(
        (channel) => channel.youtube_channel_id === requestedChannelId || channel.id === requestedChannelId
      ) ?? null,
    [visibleChannels, requestedChannelId]
  )

  useEffect(() => {
    if (!selectedChannel) {
      setVideos([])
      setDiscoveryVideos([])
      setDiscoveryLoading(false)
      setVideosError(null)
      setVideosLoading(false)
      setActiveVideoId(null)
      setVideoSearch('')
      setShowMyPlaylist(false)
      return
    }

    let cancelled = false
    setVideosLoading(true)
    setVideosError(null)
    setVideos([])
    setActiveVideoId(null)
    setVideoSearch('')
    setShowMyPlaylist(false)

    void (async () => {
      const { data, error } = await supabase
        .from('channel_videos_cache')
        .select('youtube_video_id, title, thumbnail_url, position')
        .eq('channel_id', selectedChannel.id)
        .order('position', { ascending: true })

      if (cancelled) return
      setVideosLoading(false)
      if (error) {
        setVideosError(error.message)
        return
      }
      setVideos((data ?? []) as ChannelVideoRow[])
    })()

    return () => {
      cancelled = true
    }
  }, [selectedChannel])

  useEffect(() => {
    if (!selectedChannel || visibleChannels.length === 0) {
      setDiscoveryVideos([])
      setDiscoveryLoading(false)
      return
    }

    let cancelled = false
    setDiscoveryLoading(true)
    setDiscoveryVideos([])

    void (async () => {
      const perChannel = await Promise.all(
        visibleChannels.map(async (channel) => {
          const { data, error } = await supabase
            .from('channel_videos_cache')
            .select('youtube_video_id, title, thumbnail_url, position')
            .eq('channel_id', channel.id)
            .order('position', { ascending: true })

          if (error || !data?.length) return [] as DiscoveryVideo[]
          return (data as ChannelVideoRow[]).map((row) => ({
            ...row,
            channelId: channel.id,
            youtubeChannelId: channel.youtube_channel_id,
            channelName: channel.channel_name,
          }))
        })
      )

      if (cancelled) return
      setDiscoveryVideos(buildDiverseVideoMix(perChannel.flat()))
      setDiscoveryLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [selectedChannel, visibleChannels])

  useEffect(() => {
    if (videos.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((current) =>
      current && videos.some((video) => video.youtube_video_id === current)
        ? current
        : videos[0].youtube_video_id
    )
  }, [videos])

  const channelScopedVideos = useMemo((): DiscoveryVideo[] => {
    if (!selectedChannel) return []
    return videos.map((video) => ({
      ...video,
      channelId: selectedChannel.id,
      youtubeChannelId: selectedChannel.youtube_channel_id,
      channelName: selectedChannel.channel_name,
    }))
  }, [videos, selectedChannel])

  const watchSourceVideos = useMemo(
    () => (discoveryVideos.length > 0 ? discoveryVideos : channelScopedVideos),
    [discoveryVideos, channelScopedVideos]
  )

  const playlistSourceVideos = useMemo(
    () =>
      showMyPlaylist
        ? watchSourceVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id))
        : watchSourceVideos,
    [showMyPlaylist, watchSourceVideos, savedPlaylistIds]
  )
  const filteredVideos = useMemo(
    () => filterVideosByTitle(playlistSourceVideos, videoSearch),
    [playlistSourceVideos, videoSearch]
  )
  const activeVideo = useMemo(
    () => watchSourceVideos.find((video) => video.youtube_video_id === activeVideoId) ?? null,
    [watchSourceVideos, activeVideoId]
  )
  const activeQueueIndex = useMemo(
    () => filteredVideos.findIndex((video) => video.youtube_video_id === activeVideoId),
    [filteredVideos, activeVideoId]
  )
  const hasNextVideo = activeQueueIndex >= 0 && activeQueueIndex < filteredVideos.length - 1
  const sidebarVideos = useMemo(
    () => filteredVideos.filter((video) => video.youtube_video_id !== activeVideoId),
    [filteredVideos, activeVideoId]
  )
  const playlistCountInChannel = useMemo(
    () => watchSourceVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id)).length,
    [watchSourceVideos, savedPlaylistIds]
  )

  const selectWatchVideo = (videoId: string) => {
    setActiveVideoId(videoId)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const togglePlaylistVideo = (videoId: string) => {
    if (!deviceId) return
    setSavedPlaylistIds((current) => {
      const next = new Set(current)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      savePlaylistIds(deviceId, next)
      return next
    })
  }

  const goNextVideo = () => {
    if (!hasNextVideo) return
    selectWatchVideo(filteredVideos[activeQueueIndex + 1].youtube_video_id)
  }

  const goPreviousVideo = () => {
    if (activeQueueIndex <= 0) return
    selectWatchVideo(filteredVideos[activeQueueIndex - 1].youtube_video_id)
  }

  const openChannel = (youtubeChannelId: string) => {
    if (deviceId) saveActiveChildProfileId(deviceId)
    const next = new URLSearchParams(searchParams)
    if (deviceId) next.set('device', deviceId)
    next.set('channel', youtubeChannelId)
    navigate({ pathname: '/channels', search: `?${next.toString()}` })
  }

  const backToChannels = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('channel')
    navigate({ pathname: '/channels', search: next.toString() ? `?${next.toString()}` : '' })
  }

  return (
    <div
      className={`mx-auto flex w-full max-w-[100vw] flex-col gap-4 overflow-x-hidden pb-4 ${
        selectedChannel ? 'xl:max-w-[1754px]' : 'max-w-5xl'
      }`}
    >
      <header className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/95 to-zinc-950 p-4 shadow-2xl shadow-black/15 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25">
            <Tv className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-zinc-50">ערוצים</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {selectedDevice ? `הערוצים המאושרים של ${selectedDevice.name}` : 'כל הערוצים המאושרים לצפייה.'}
            </p>
          </div>
        </div>
      </header>

      {devicesLoading || loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/60 text-zinc-300">
          <LoadingSpinner className="h-8 w-8 border-2 border-sky-400 border-t-transparent" />
          טוען ערוצים…
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-zinc-600" aria-hidden />
          <p className="font-semibold text-zinc-300">אין עדיין פרופיל ילד מחובר</p>
        </div>
      ) : visibleChannels.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-zinc-600" aria-hidden />
          <p className="font-semibold text-zinc-300">אין עדיין ערוצים מאושרים</p>
          <p className="mt-1 text-sm text-zinc-500">ההורה יכול להוסיף ערוצים מתוך בקרת הורים.</p>
        </div>
      ) : selectedChannel ? (
        <section className="max-w-full overflow-x-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70 p-3 shadow-xl shadow-black/10 sm:p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={backToChannels}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800"
                aria-label="חזרה לערוצים"
              >
                <ArrowRight className="h-5 w-5" aria-hidden />
              </button>
              {selectedChannel.channel_thumbnail ? (
                <img
                  src={selectedChannel.channel_thumbnail}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-lg font-black text-zinc-50">{selectedChannel.channel_name}</h2>
                <p className="text-sm text-zinc-500">רשימת הסרטונים בערוץ</p>
              </div>
            </div>
          </div>

          {videosLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-zinc-300">
              <LoadingSpinner className="h-7 w-7 border-2 border-sky-400 border-t-transparent" />
              טוען סרטונים…
            </div>
          ) : videosError ? (
            <p className="rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {videosError}
            </p>
          ) : videos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-4 py-10 text-center text-sm text-zinc-500">
              אין סרטונים זמינים בערוץ הזה כרגע.
            </div>
          ) : activeVideo ? (
            <YoutubeWatchLayout
              className="px-0 pb-2"
              main={
                <>
                  <div className="relative w-full max-w-full overflow-hidden bg-black lg:rounded-none">
                    <div className="relative pt-[56.25%]">
                      <div className="absolute inset-0 min-h-0">
                        <CleanPlayer
                          videoId={activeVideo.youtube_video_id}
                          title={activeVideo.title}
                          channelTitle={activeVideo.channelName}
                          posterUrl={activeVideo.thumbnail_url}
                          onPreviousTrack={goPreviousVideo}
                          onNextTrack={goNextVideo}
                          hasNextTrack={hasNextVideo}
                          className="h-full w-full"
                        />
                      </div>
                    </div>
                  </div>
                  <YoutubeWatchVideoDetails
                    title={activeVideo.title}
                    channelName={activeVideo.channelName}
                    subtitle={
                      discoveryLoading
                        ? 'טוען המלצות מכל הערוצים…'
                        : `${watchSourceVideos.length} סרטונים מאושרים מכל הערוצים`
                    }
                    actions={
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-2 rounded-full !px-4 !py-2 text-xs font-black"
                        onClick={() => togglePlaylistVideo(activeVideo.youtube_video_id)}
                      >
                        {savedPlaylistIds.has(activeVideo.youtube_video_id) ? (
                          <Check className="h-4 w-4" aria-hidden />
                        ) : (
                          <Plus className="h-4 w-4" aria-hidden />
                        )}
                        {savedPlaylistIds.has(activeVideo.youtube_video_id) ? 'בפלייליסט שלי' : 'הוסף לפלייליסט'}
                      </Button>
                    }
                  />
                </>
              }
              sidebar={
                <>
                  <div className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
                    <button
                      type="button"
                      onClick={() => setShowMyPlaylist((current) => !current)}
                      aria-pressed={showMyPlaylist}
                      className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition ${
                        showMyPlaylist
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-950/30'
                          : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                      }`}
                    >
                      <ListMusic className="h-4 w-4" aria-hidden />
                      הפלייליסט שלי
                      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px]">
                        {playlistCountInChannel}
                      </span>
                    </button>
                  </div>
                  <ChannelVideoSearchBar
                    id="child-channel-watch-search"
                    value={videoSearch}
                    onChange={setVideoSearch}
                    totalCount={playlistSourceVideos.length}
                    filteredCount={filteredVideos.length}
                    channelLabel={selectedChannel.channel_name}
                    className="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3"
                  />
                  <YoutubeSuggestedList title={showMyPlaylist ? 'הסרטונים ששמרתי' : 'סרטונים מומלצים'}>
                    {sidebarVideos.map((video) => (
                      <li key={`${video.channelId}-${video.youtube_video_id}`} className="w-full">
                        <YoutubeVideoCard
                          layout="row"
                          title={video.title}
                          thumbnail={video.thumbnail_url}
                          channelName={video.channelName}
                          active={false}
                          onClick={() => selectWatchVideo(video.youtube_video_id)}
                          actionSlot={
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                togglePlaylistVideo(video.youtube_video_id)
                              }}
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-xs transition ${
                                savedPlaylistIds.has(video.youtube_video_id)
                                  ? 'border-sky-400/60 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
                              }`}
                              title={
                                savedPlaylistIds.has(video.youtube_video_id)
                                  ? 'הסר מהפלייליסט שלי'
                                  : 'הוסף לפלייליסט'
                              }
                              aria-label={
                                savedPlaylistIds.has(video.youtube_video_id)
                                  ? `הסר את ${video.title} מהפלייליסט שלי`
                                  : `הוסף את ${video.title} לפלייליסט שלי`
                              }
                            >
                              {savedPlaylistIds.has(video.youtube_video_id) ? (
                                <Check className="h-4 w-4" aria-hidden />
                              ) : (
                                <Plus className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          }
                        />
                      </li>
                    ))}
                  </YoutubeSuggestedList>
                  {sidebarVideos.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                      {showMyPlaylist
                        ? videoSearch.trim()
                          ? 'אין סרטונים שמורים שמתאימים לחיפוש.'
                          : 'הפלייליסט שלך עדיין ריק בערוץ הזה.'
                        : discoveryLoading
                          ? 'טוען סרטונים מומלצים…'
                          : videoSearch.trim()
                            ? 'אין סרטונים שמתאימים לחיפוש.'
                            : 'אין עוד סרטונים מומלצים כרגע.'}
                    </p>
                  ) : null}
                </>
              }
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-4 py-10 text-center text-sm text-zinc-500">
              אין סרטון פעיל להצגה.
            </div>
          )}
        </section>
      ) : (
        <section
          aria-label="ערוצים מאושרים"
          className="mx-auto grid w-full max-w-[1040px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {visibleChannels.map((channel) => (
            <article
              key={channel.id}
              role="button"
              tabIndex={0}
              onClick={() => openChannel(channel.youtube_channel_id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openChannel(channel.youtube_channel_id)
                }
              }}
              className="group w-full max-w-[220px] cursor-pointer justify-self-center overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <div className="h-28 bg-zinc-900 sm:h-32">
                {channel.channel_thumbnail ? (
                  <img
                    src={channel.channel_thumbnail}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">
                    <Tv className="h-10 w-10" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex min-h-[108px] flex-col p-3 text-right">
                <h2 className="line-clamp-2 text-sm font-bold leading-snug text-zinc-100">{channel.channel_name}</h2>
                {channel.category ? (
                  <p className="mt-1 truncate text-xs text-sky-300">{channel.category}</p>
                ) : null}
                <Button
                  type="button"
                  className="mt-auto min-h-[38px] w-full justify-center rounded-xl bg-zinc-800 px-3 text-xs font-black text-zinc-50 shadow-sm shadow-black/20 ring-1 ring-white/10 hover:bg-zinc-700"
                  onClick={(event) => {
                    event.stopPropagation()
                    openChannel(channel.youtube_channel_id)
                  }}
                >
                  כנס לערוץ
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
