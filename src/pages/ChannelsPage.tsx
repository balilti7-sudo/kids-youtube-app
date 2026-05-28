import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ListMusic, Plus, Tv } from 'lucide-react'
import { ChildChannelsNavCarousel } from '../components/kid/ChildChannelsNavCarousel'
import { useChannels } from '../hooks/useChannels'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { ChildWatchPlayerShell } from '../components/kid/ChildWatchPlayerShell'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { YoutubeSuggestedList } from '../components/youtube/YoutubeSuggestedList'
import { YoutubeVideoCard } from '../components/youtube/YoutubeVideoCard'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { ChannelVideoBrowseRows } from '../components/kid/ChannelVideoBrowseRows'
import { YoutubeShortCard } from '../components/youtube/YoutubeShortCard'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import { buildWatchRecommendationQueue } from '../lib/buildDiverseVideoMix'
import { getChildCachedChannelVideos, getChildDeviceState, getSavedChildAccessToken } from '../lib/childDevice'
import { supabase } from '../lib/supabase'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../lib/activeDeviceSelection'
import { prefetchStreamInfo } from '../lib/streamApi'
import {
  DEFAULT_INTERCEPT_SETTINGS,
  settingsFromDevice,
  tryBeginPlayback,
  type InterceptPendingVideo,
} from '../lib/educationalIntercept'
import {
  enrichVideosWithFormat,
  toWatchableVideo,
  type WatchableVideoBase,
} from '../lib/videoFormatClassification'
import { ScreenTimeChildGate } from '../components/kid/ScreenTimeChildGate'
import { EducationalInterceptGate } from '../components/kid/EducationalInterceptGate'
import { useLocalScreenTime } from '../hooks/useLocalScreenTime'

type ChannelWatchVideo = WatchableVideoBase & {
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
  const [videos, setVideos] = useState<WatchableVideoBase[]>([])
  const [watchStarted, setWatchStarted] = useState(false)
  const [channelRecommendations, setChannelRecommendations] = useState<ChannelWatchVideo[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  /** Snapshot at tap time so the player mounts before discovery/metadata catches up. */
  const [playingVideo, setPlayingVideo] = useState<ChannelWatchVideo | null>(null)
  const [videoSearch, setVideoSearch] = useState('')
  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Set<string>>(new Set())
  const [showMyPlaylist, setShowMyPlaylist] = useState(false)
  const [childInterceptSettings, setChildInterceptSettings] = useState(DEFAULT_INTERCEPT_SETTINGS)

  useEffect(() => {
    const token = getSavedChildAccessToken()
    if (!token) return
    const load = () => {
      void getChildDeviceState(token).then(({ data }) => {
        if (data) setChildInterceptSettings(settingsFromDevice(data))
      })
    }
    load()
    const id = window.setInterval(load, 3_000)
    return () => window.clearInterval(id)
  }, [])

  const interceptSettings = useMemo(() => {
    const fromList = devices.find((d) => d.id === deviceId)
    if (fromList) return settingsFromDevice(fromList)
    return childInterceptSettings
  }, [devices, deviceId, childInterceptSettings])

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
      setChannelRecommendations([])
      setRecommendationsLoading(false)
      setVideosError(null)
      setVideosLoading(false)
      setActiveVideoId(null)
      setPlayingVideo(null)
      setVideoSearch('')
      setShowMyPlaylist(false)
      setWatchStarted(false)
      return
    }

    let cancelled = false
    setVideosLoading(true)
    setVideosError(null)
    setVideos([])
    setActiveVideoId(null)
    setPlayingVideo(null)
    setVideoSearch('')
    setShowMyPlaylist(false)
    setWatchStarted(false)

    void (async () => {
      const mapRows = (
        rows: Array<{
          youtube_video_id: string
          title: string
          thumbnail_url: string | null
          duration_seconds?: number | null
        }>
      ) =>
        rows.map((row) =>
          toWatchableVideo({
            youtube_video_id: row.youtube_video_id,
            title: row.title,
            thumbnail_url: row.thumbnail_url,
            duration_seconds: row.duration_seconds ?? null,
          })
        )

      const kidToken = getSavedChildAccessToken()
      if (kidToken) {
        const { data, error } = await getChildCachedChannelVideos(kidToken, selectedChannel.youtube_channel_id)
        if (cancelled) return
        if (error) {
          setVideosLoading(false)
          setVideosError(error.message)
          return
        }
        const rows = (data ?? []).map((row) => ({
          youtube_video_id: row.youtube_video_id,
          title: row.title,
          thumbnail_url: row.thumbnail_url,
          duration_seconds: row.duration_seconds ?? null,
        }))
        const fast = mapRows(rows)
        setVideos(fast)
        setVideosLoading(false)
        void enrichVideosWithFormat(
          rows.map((row) => ({
            youtube_video_id: row.youtube_video_id,
            title: row.title,
            thumbnail_url: row.thumbnail_url,
            durationSeconds: row.duration_seconds ?? null,
          }))
        ).then((enriched) => {
          if (!cancelled) setVideos(enriched)
        })
        return
      }

      const { data, error } = await supabase
        .from('channel_videos_cache')
        .select('youtube_video_id, title, thumbnail_url, duration_seconds, position')
        .eq('channel_id', selectedChannel.id)
        .order('position', { ascending: true })

      if (cancelled) return
      if (error) {
        setVideosLoading(false)
        setVideosError(error.message)
        return
      }
      const rows = (data ?? []).map((row) => {
        const r = row as {
          youtube_video_id: string
          title: string
          thumbnail_url: string | null
          duration_seconds?: number | null
        }
        return {
          youtube_video_id: r.youtube_video_id,
          title: r.title,
          thumbnail_url: r.thumbnail_url,
          duration_seconds: r.duration_seconds ?? null,
        }
      })
      const fast = mapRows(rows)
      setVideos(fast)
      setVideosLoading(false)
      void enrichVideosWithFormat(
        rows.map((row) => ({
          youtube_video_id: row.youtube_video_id,
          title: row.title,
          thumbnail_url: row.thumbnail_url,
          durationSeconds: row.duration_seconds ?? null,
        }))
      ).then((enriched) => {
        if (!cancelled) setVideos(enriched)
      })
    })()

    return () => {
      cancelled = true
    }
  }, [selectedChannel])

  const channelScopedVideos = useMemo((): ChannelWatchVideo[] => {
    if (!selectedChannel) return []
    return videos.map((video) => ({
      ...video,
      channelId: selectedChannel.id,
      youtubeChannelId: selectedChannel.youtube_channel_id,
      channelName: selectedChannel.channel_name,
    }))
  }, [videos, selectedChannel])

  const playlistSourceVideos = useMemo(
    () =>
      showMyPlaylist
        ? channelScopedVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id))
        : channelScopedVideos,
    [showMyPlaylist, channelScopedVideos, savedPlaylistIds]
  )
  const filteredVideos = useMemo(
    () => filterVideosByTitle(playlistSourceVideos, videoSearch),
    [playlistSourceVideos, videoSearch]
  )
  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null
    const fromChannel = channelScopedVideos.find((video) => video.youtube_video_id === activeVideoId)
    if (fromChannel) return fromChannel
    if (playingVideo?.youtube_video_id === activeVideoId) return playingVideo
    return null
  }, [channelScopedVideos, activeVideoId, playingVideo])
  const activeQueueIndex = useMemo(
    () => filteredVideos.findIndex((video) => video.youtube_video_id === activeVideoId),
    [filteredVideos, activeVideoId]
  )
  const hasNextVideo = activeQueueIndex >= 0 && activeQueueIndex < filteredVideos.length - 1
  useEffect(() => {
    if (!watchStarted || !selectedChannel) {
      setChannelRecommendations([])
      setRecommendationsLoading(false)
      return
    }

    let cancelled = false
    setRecommendationsLoading(true)

    const frameId = requestAnimationFrame(() => {
      const pool = filteredVideos.filter(
        (video) =>
          video.youtube_video_id !== activeVideoId && video.channelId === selectedChannel.id
      )
      const queue = activeVideo
        ? buildWatchRecommendationQueue(pool, activeVideo.format === 'short')
        : pool
      if (!cancelled) {
        setChannelRecommendations(queue)
        setRecommendationsLoading(false)
      }
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
    }
  }, [watchStarted, selectedChannel, filteredVideos, activeVideoId, activeVideo])

  const playlistCountInChannel = useMemo(
    () => channelScopedVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id)).length,
    [channelScopedVideos, savedPlaylistIds]
  )

  const toChannelWatchVideo = useCallback(
    (video: WatchableVideoBase): ChannelWatchVideo | null => {
      if (!selectedChannel) return null
      return {
        ...video,
        channelId: selectedChannel.id,
        youtubeChannelId: selectedChannel.youtube_channel_id,
        channelName: selectedChannel.channel_name,
      }
    },
    [selectedChannel]
  )

  const selectWatchVideo = useCallback(
    (input: string | WatchableVideoBase | ChannelWatchVideo) => {
      let videoId: string
      let snapshot: ChannelWatchVideo | null = null

      if (typeof input === 'string') {
        videoId = input
        const base = videos.find((video) => video.youtube_video_id === videoId) ?? null
        if (base) snapshot = toChannelWatchVideo(base)
      } else if ('channelName' in input) {
        videoId = input.youtube_video_id
        snapshot = input
      } else {
        videoId = input.youtube_video_id
        snapshot = toChannelWatchVideo(input)
      }

      const pending: InterceptPendingVideo = {
        videoId,
        title: snapshot?.title,
        channelTitle: snapshot?.channelName,
        posterUrl: snapshot?.thumbnail_url ?? null,
      }

      if (!tryBeginPlayback(pending, interceptSettings)) {
        if (snapshot) setPlayingVideo(snapshot)
        return
      }

      if (snapshot) setPlayingVideo(snapshot)
      prefetchStreamInfo(videoId)
      setWatchStarted(true)
      setActiveVideoId(videoId)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [videos, toChannelWatchVideo, interceptSettings]
  )

  const resumePendingPlayback = useCallback(
    (pending: InterceptPendingVideo | null) => {
      if (!pending?.videoId) return
      const base = videos.find((video) => video.youtube_video_id === pending.videoId) ?? null
      const snapshot = base ? toChannelWatchVideo(base) : null
      if (snapshot) setPlayingVideo(snapshot)
      prefetchStreamInfo(pending.videoId)
      setWatchStarted(true)
      setActiveVideoId(pending.videoId)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [videos, toChannelWatchVideo]
  )

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

  const renderPlaylistAction = (videoId: string, title: string) => (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        togglePlaylistVideo(videoId)
      }}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-xs transition ${
        savedPlaylistIds.has(videoId)
          ? 'border-sky-400/60 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30'
          : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
      }`}
      title={savedPlaylistIds.has(videoId) ? 'הסר מהפלייליסט שלי' : 'הוסף לפלייליסט'}
      aria-label={
        savedPlaylistIds.has(videoId) ? `הסר את ${title} מהפלייליסט שלי` : `הוסף את ${title} לפלייליסט שלי`
      }
    >
      {savedPlaylistIds.has(videoId) ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
    </button>
  )

  const goNextVideo = useCallback(() => {
    if (!hasNextVideo) return
    selectWatchVideo(filteredVideos[activeQueueIndex + 1])
  }, [hasNextVideo, filteredVideos, activeQueueIndex, selectWatchVideo])

  const goPreviousVideo = useCallback(() => {
    if (activeQueueIndex <= 0) return
    selectWatchVideo(filteredVideos[activeQueueIndex - 1])
  }, [activeQueueIndex, filteredVideos, selectWatchVideo])

  const openChannel = (youtubeChannelId: string) => {
    if (deviceId) saveActiveChildProfileId(deviceId)
    setWatchStarted(false)
    const next = new URLSearchParams(searchParams)
    if (deviceId) next.set('device', deviceId)
    next.set('channel', youtubeChannelId)
    navigate({ pathname: '/channels', search: `?${next.toString()}` })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goHome = () => {
    setWatchStarted(false)
    const next = new URLSearchParams(searchParams)
    next.delete('channel')
    navigate({ pathname: '/channels', search: next.toString() ? `?${next.toString()}` : '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const showChannelsNav =
    !devicesLoading && !loading && devices.length > 0 && visibleChannels.length > 0

  const screenTime = useLocalScreenTime()

  useEffect(() => {
    if (!screenTime.playbackBlocked) return
    setWatchStarted(false)
    setActiveVideoId(null)
    setPlayingVideo(null)
  }, [screenTime.playbackBlocked])

  return (
    <ScreenTimeChildGate>
    <EducationalInterceptGate settings={interceptSettings} onResumePlayback={resumePendingPlayback}>
    <div
      className={`mx-auto flex w-full max-w-[100vw] flex-col gap-4 overflow-x-hidden pb-4 ${
        selectedChannel ? 'xl:max-w-[1754px]' : 'max-w-5xl'
      }`}
    >
      <header className="sticky top-0 z-20 rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/98 to-zinc-950 p-4 shadow-2xl shadow-black/15 backdrop-blur-md sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25">
            <Tv className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black text-zinc-50">
              {selectedChannel ? selectedChannel.channel_name : 'ערוצים'}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {selectedChannel
                ? 'צפייה בערוץ — החליפו ערוץ או חזרו לבית מהשורה למטה'
                : selectedDevice
                  ? `הערוצים המאושרים של ${selectedDevice.name}`
                  : 'כל הערוצים המאושרים לצפייה.'}
            </p>
          </div>
        </div>
        {showChannelsNav ? (
          <ChildChannelsNavCarousel
            channels={visibleChannels}
            activeYoutubeChannelId={selectedChannel?.youtube_channel_id ?? null}
            onHome={goHome}
            onSelectChannel={openChannel}
          />
        ) : null}
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
        <section className="max-w-full overflow-x-hidden rounded-none border-0 bg-transparent p-0 shadow-none sm:rounded-3xl sm:border sm:border-zinc-800 sm:bg-zinc-950/70 sm:p-4 sm:shadow-xl sm:shadow-black/10">
          {videosError ? (
            <p className="rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {videosError}
            </p>
          ) : watchStarted && activeVideoId ? (
            <YoutubeWatchLayout
              className="px-0 pb-2"
              main={
                <div className="flex w-full min-w-0 flex-col">
                  <ChildWatchPlayerShell
                    videoId={activeVideoId}
                    title={activeVideo?.title ?? playingVideo?.title ?? 'טוען…'}
                    channelTitle={activeVideo?.channelName ?? playingVideo?.channelName ?? selectedChannel.channel_name}
                    posterUrl={activeVideo?.thumbnail_url ?? playingVideo?.thumbnail_url ?? null}
                    format={activeVideo?.format ?? playingVideo?.format ?? 'long'}
                    onPreviousTrack={goPreviousVideo}
                    onNextTrack={goNextVideo}
                    hasNextTrack={hasNextVideo}
                  />
                  <YoutubeWatchVideoDetails
                    className="px-1 pt-3 sm:px-0.5"
                    title={activeVideo?.title ?? playingVideo?.title ?? 'טוען…'}
                    channelName={
                      activeVideo?.channelName ?? playingVideo?.channelName ?? selectedChannel.channel_name
                    }
                    subtitle={
                      recommendationsLoading || videosLoading
                        ? `טוען סרטונים מ${selectedChannel.channel_name}…`
                        : `${channelScopedVideos.length} סרטונים בערוץ`
                    }
                    actions={
                      <Button
                        type="button"
                        variant="secondary"
                        className="gap-2 rounded-full !px-4 !py-2 text-xs font-black"
                        onClick={() => togglePlaylistVideo(activeVideoId)}
                      >
                        {savedPlaylistIds.has(activeVideoId) ? (
                          <Check className="h-4 w-4" aria-hidden />
                        ) : (
                          <Plus className="h-4 w-4" aria-hidden />
                        )}
                        {savedPlaylistIds.has(activeVideoId) ? 'בפלייליסט שלי' : 'הוסף לפלייליסט'}
                      </Button>
                    }
                  />
                </div>
              }
              sidebar={
                <div className="flex flex-col gap-3 px-1 sm:px-0">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-2">
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
                  <YoutubeSuggestedList
                    title={
                      showMyPlaylist
                        ? 'הסרטונים ששמרתי'
                        : (activeVideo?.format ?? playingVideo?.format) === 'short'
                          ? 'עוד Shorts מומלצים'
                          : 'סרטונים מומלצים'
                    }
                  >
                    {channelRecommendations.map((video) => (
                      <li key={`${video.channelId}-${video.youtube_video_id}`} className="w-full">
                        {video.format === 'short' ? (
                          <YoutubeShortCard
                            variant="row"
                            title={video.title}
                            thumbnail={video.thumbnail_url}
                            onClick={() => selectWatchVideo(video)}
                            actionSlot={renderPlaylistAction(video.youtube_video_id, video.title)}
                          />
                        ) : (
                          <YoutubeVideoCard
                            layout="row"
                            title={video.title}
                            thumbnail={video.thumbnail_url}
                            channelName={video.channelName}
                            active={false}
                            onClick={() => selectWatchVideo(video)}
                            actionSlot={renderPlaylistAction(video.youtube_video_id, video.title)}
                          />
                        )}
                      </li>
                    ))}
                  </YoutubeSuggestedList>
                  {channelRecommendations.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                      {showMyPlaylist
                        ? videoSearch.trim()
                          ? 'אין סרטונים שמורים שמתאימים לחיפוש.'
                          : 'הפלייליסט שלך עדיין ריק בערוץ הזה.'
                        : recommendationsLoading || videosLoading
                          ? 'טוען סרטונים מהערוץ…'
                          : videoSearch.trim()
                            ? 'אין סרטונים שמתאימים לחיפוש.'
                            : 'אין עוד סרטונים בערוץ הזה.'}
                    </p>
                  ) : null}
                </div>
              }
            />
          ) : videosLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-zinc-300">
              <LoadingSpinner className="h-7 w-7 border-2 border-sky-400 border-t-transparent" />
              טוען סרטונים…
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-4 py-10 text-center text-sm text-zinc-500">
              אין סרטונים זמינים בערוץ הזה כרגע.
            </div>
          ) : (
            <ChannelVideoBrowseRows
              videos={videos}
              activeVideoId={activeVideoId}
              onSelectVideo={selectWatchVideo}
              renderAction={(video) => renderPlaylistAction(video.youtube_video_id, video.title)}
            />
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
    </EducationalInterceptGate>
    </ScreenTimeChildGate>
  )
}
