import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bookmark, Check, ListMusic, Plus, Search, ShieldAlert, Trash2, Tv } from 'lucide-react'
import { ChildChannelsNavCarousel } from '../components/kid/ChildChannelsNavCarousel'
import { RemoveChannelModal } from '../components/channels/RemoveChannelModal'
import { TopicDiscoveryModal } from '../components/channels/TopicDiscoveryModal'
import { ChannelAddedSuccessModal } from '../components/channels/ChannelAddedSuccessModal'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { useChannels } from '../hooks/useChannels'
import { useAuth } from '../hooks/useAuth'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { useLongPress } from '../hooks/useLongPress'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { ChildWatchPlayerShell } from '../components/kid/ChildWatchPlayerShell'
import { KidShortsLane } from '../components/kid/KidShortsLane'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { YoutubeLikeButton } from '../components/youtube/YoutubeLikeButton'
import { ChannelVideoBrowseRows } from '../components/kid/ChannelVideoBrowseRows'
import { ChannelContentTabs, type ChannelContentTab } from '../components/youtube/ChannelContentTabs'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import { shouldHideFromChildBrowse } from '../lib/liveStreamPolicy'
import { getChildCachedChannelVideos, getSavedChildAccessToken } from '../lib/childDevice'
import { supabase } from '../lib/supabase'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../lib/activeDeviceSelection'
import { logPlaybackStreamRequest } from '../lib/streamApi'
import { fetchChannelUploadsPage, resolveChannelUploadsCursor } from '../lib/youtube'
import {
  enrichVideosWithFormat,
  filterVideosRespectingAllowShorts,
  stabilizeWatchableVideoList,
  toWatchableVideo,
  buildYoutubeWatchUrl,
  classifyContentShape,
  shouldRouteToShortsLane,
  type VideoFormat,
  type WatchableVideoBase,
} from '../lib/videoFormatClassification'
import { formatViewCountLabel } from '../lib/formatYoutubeCount'
import { formatRelativePublishedAt, joinVideoMetadataParts } from '../lib/formatRelativeTime'
import { ScreenTimeChildGate } from '../components/kid/ScreenTimeChildGate'
import { LionProgressionProvider } from '../contexts/LionProgressionContext'
import { ChildRuntimeProvider, useChildRuntimeOptional } from '../contexts/ChildRuntimeContext'
import { LionProfileButton } from '../components/kid/LionProfileButton'
import { DailyWatchBudgetTracker } from '../components/kid/DailyWatchBudgetTracker'
import { isShortsBlockedForProfile } from '../lib/childContentSafety'
import { setPlaybackContentShape } from '../lib/playbackContentShape'
import { setPlaybackPresentationShape } from '../lib/playbackPresentationShape'
import {
  setPlaybackPresentationContext,
  setPlaybackPortraitThumbnailIds,
} from '../lib/playbackPresentationContext'
import { inferPresentationShape } from '../lib/presentationShape'
import { usePortraitVideoThumbnailIds } from '../hooks/usePortraitVideoThumbnailIds'
import { buildShortsAwareNavQueue } from '../lib/shortsNavQueue'
import { buildShortsLaneItem } from '../lib/shortsFeedRank'
import { listHiddenVideoIdsForChild, listHiddenVideoIdsForDevice } from '../lib/hiddenVideos'
import { toast } from 'sonner'
import { policyFromDeviceFields, syncParentalControlPolicy } from '../lib/syncParentalControlPolicy'
import { scrollPlayerIntoViewForWatch } from '../lib/scrollPlayerIntoView'
import {
  captureBrowseNavContext,
  restoreBrowseScroll,
  type BrowseNavContext,
} from '../lib/watchPlayerNav'
import { usePlayerOwnedBackNavigation, discardPlayerHistoryLayerQuietly } from '../hooks/usePlayerOwnedBackNavigation'
import { useChannelYoutubeShorts } from '../hooks/useChannelYoutubeShorts'
import { requestChromeOffsetRefresh, setChromeVar, usePublishChromeOffset } from '../lib/chromeOffset'
import {
  getParentPinSession,
  isParentManagementSessionVerified,
  setParentPinSession,
} from '../lib/parentPinSession'
import { readLocalParentSession } from '../lib/localParentAdmin'
import { verifyParentManagementPin } from '../lib/verifyParentManagementPin'
import type { WhitelistedChannel, YouTubeChannelResult } from '../types'

type ChannelWatchVideo = WatchableVideoBase & {
  channelId: string
  youtubeChannelId: string
  channelName: string
}

function ChannelHomeCard({
  channel,
  onOpen,
  onRemove,
}: {
  channel: WhitelistedChannel
  onOpen: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const longPress = useLongPress(onRemove)
  const { consumeLongPress, ...pressHandlers } = longPress

  return (
    <article
      className="group relative w-full max-w-none justify-self-stretch overflow-hidden rounded-2xl border border-yt-border bg-yt-surface shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-yt-border hover:bg-yt-surfaceHover xs:rounded-3xl"
    >
      <button
        type="button"
        onClick={() => {
          if (consumeLongPress()) return
          onOpen()
        }}
        {...pressHandlers}
        className="w-full cursor-pointer text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <div className="h-28 bg-yt-surfaceHover sm:h-32">
          {channel.channel_thumbnail ? (
            <img
              src={channel.channel_thumbnail}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-yt-textMuted">
              <Tv className="h-10 w-10" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex min-h-[108px] flex-col p-3 text-right">
          <h2 className="line-clamp-2 text-sm font-bold leading-snug text-yt-text">{channel.channel_name}</h2>
          {channel.category ? (
            <p className="mt-1 truncate text-xs text-sky-300">{channel.category}</p>
          ) : null}
          <span className="mt-auto inline-flex min-h-[38px] w-full items-center justify-center rounded-xl bg-yt-surfaceHover px-3 text-xs font-black text-yt-text shadow-sm shadow-black/20 ring-1 ring-white/10">
            {t('channels.enterChannel')}
          </span>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute end-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-red-300 shadow ring-1 ring-red-400/40"
        aria-label={t('channels.removeAria', { name: channel.channel_name })}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </article>
  )
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

/**
 * Raw transport errors (Cloudflare "error code: 522", fetch failures) are meaningless
 * to parents — show a friendly, retryable Hebrew message instead.
 */
function friendlyVideosError(raw: string): string {
  if (
    /error code:\s*5\d\d|\b52[2-4]\b|cloudflare|timed?\s*out|timeout|failed to fetch|networkerror|load failed|err_connection|err_network|socket|econn/i.test(
      raw
    )
  ) {
    return 'החיבור לשרת נכשל זמנית. בדקו את האינטרנט ונסו שוב בעוד רגע.'
  }
  return raw
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

function ChannelsPageInner() {
  const { t } = useTranslation()
  const childRuntime = useChildRuntimeOptional()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devicesLoading } = useDevices(ownerUserId)
  const requestedDeviceId = searchParams.get('device') ?? getSavedActiveChildProfileId()
  const requestedChannelId = searchParams.get('channel')
  const [deviceId, setDeviceId] = useState<string | null>(() => requestedDeviceId ?? getSavedActiveChildProfileId())
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const pendingRemoveRef = useRef<WhitelistedChannel | null>(null)
  const [pinPurpose, setPinPurpose] = useState<'remove' | 'add' | null>(null)
  const [channelSearchOpen, setChannelSearchOpen] = useState(false)
  const [addedSearchChannelIds, setAddedSearchChannelIds] = useState<Set<string>>(() => new Set())
  const [addingSearchChannelId, setAddingSearchChannelId] = useState<string | null>(null)
  const [channelAddSuccessOpen, setChannelAddSuccessOpen] = useState(false)
  const [channelAddSuccessName, setChannelAddSuccessName] = useState<string | null>(null)
  const [channelAddSuccessCount, setChannelAddSuccessCount] = useState(1)
  const childAccessToken = getSavedChildAccessToken()
  const localParentPinRef = useRef<string | null>(null)
  const [videos, setVideos] = useState<WatchableVideoBase[]>([])
  const [watchStarted, setWatchStarted] = useState(false)
  const [channelContentTab, setChannelContentTab] = useState<ChannelContentTab>('home')
  const [shortsLaneOpen, setShortsLaneOpen] = useState(false)
  const [shortsLaneSeedVideoId, setShortsLaneSeedVideoId] = useState<string | null>(null)
  const browseNavContextRef = useRef<BrowseNavContext | null>(null)
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  /** Snapshot at tap time so the player mounts before discovery/metadata catches up. */
  const [playingVideo, setPlayingVideo] = useState<ChannelWatchVideo | null>(null)
  /** Lock aspect ratio at play tap — enrich must not flip long↔short mid-playback. */
  const [playbackFormat, setPlaybackFormat] = useState<VideoFormat>('long')
  const playerAnchorRef = useRef<HTMLDivElement | null>(null)
  /** Home tabs + video list — scroll target when entering a channel. */
  const channelContentRef = useRef<HTMLElement | null>(null)
  /** Set by openChannel; consumed after the channel section mounts. */
  const pendingChannelEnterScrollRef = useRef(false)
  const isWatching = Boolean(watchStarted && activeVideoId)
  const channelsShellRef = useRef<HTMLDivElement>(null)
  const channelsPageChromeRef = useRef<HTMLElement | null>(null)
  usePublishChromeOffset(channelsPageChromeRef, channelsShellRef, '--chrome-page-top', !isWatching)

  useLayoutEffect(() => {
    if (!isWatching) return
    const target = channelsShellRef.current
    if (!target) return
    setChromeVar(target, '--chrome-page-top', 0)
    requestChromeOffsetRefresh()
  }, [isWatching])
  const [videoSearch, setVideoSearch] = useState('')
  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Set<string>>(new Set())
  const [showMyPlaylist, setShowMyPlaylist] = useState(false)
  const [allowShorts, setAllowShorts] = useState(true)
  const [videosLoadingMore, setVideosLoadingMore] = useState(false)
  const [uploadsCursor, setUploadsCursor] = useState<{
    nextPageToken: string | null
    uploadsPlaylistId: string | null
    hasMore: boolean
  } | null>(null)

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

  useEffect(() => {
    if (!selectedDevice) return
    setAllowShorts(true)
    void syncParentalControlPolicy(policyFromDeviceFields(selectedDevice))
  }, [selectedDevice])

  const { whitelist, loading, refreshChannelVideosCache, appendChannelVideosCache, removeFromWhitelist, addToWhitelist } =
    useChannels(deviceId ?? undefined, ownerUserId, {
      localAccessToken: ownerUserId ? null : childAccessToken,
      getLocalParentPin: () =>
        localParentPinRef.current ||
        readLocalParentSession()?.pin ||
        getParentPinSession() ||
        null,
    })

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
  const selectedChannelDbId = selectedChannel?.id ?? null
  const selectedYoutubeChannelId = selectedChannel?.youtube_channel_id ?? null
  const videosLoadGenRef = useRef(0)
  const loadedChannelKeyRef = useRef<string | null>(null)
  const forceRefreshedChannelRef = useRef<string | null>(null)
  const [videosReloadNonce, setVideosReloadNonce] = useState(0)

  useEffect(() => {
    if (!selectedChannelDbId || !selectedYoutubeChannelId) {
      videosLoadGenRef.current += 1
      loadedChannelKeyRef.current = null
      forceRefreshedChannelRef.current = null
      setVideos([])
      setVideosError(null)
      setVideosLoading(false)
      setActiveVideoId(null)
      setPlayingVideo(null)
      setVideoSearch('')
      setShowMyPlaylist(false)
      setWatchStarted(false)
      setUploadsCursor(null)
      return
    }

    const channelKey = selectedChannelDbId
    const youtubeChannelId = selectedYoutubeChannelId
    const channelChanged = loadedChannelKeyRef.current !== channelKey
    const requestId = ++videosLoadGenRef.current

    if (channelChanged) {
      loadedChannelKeyRef.current = channelKey
      setVideos([])
      setActiveVideoId(null)
      setPlayingVideo(null)
      setVideoSearch('')
      setShowMyPlaylist(false)
      setWatchStarted(false)
      setUploadsCursor(null)
      setVideosLoading(true)
    }

    setVideosError(null)

    const mapRows = (
      rows: Array<{
        youtube_video_id: string
        title: string
        thumbnail_url: string | null
        duration_seconds?: number | null
        published_at?: string | null
      }>
    ) =>
      rows.map((row) =>
        toWatchableVideo({
          youtube_video_id: row.youtube_video_id,
          title: row.title,
          thumbnail_url: row.thumbnail_url,
          duration_seconds: row.duration_seconds ?? null,
          published_at: row.published_at ?? null,
        })
      )

    const fetchCachedRows = async () => {
      const kidToken = getSavedChildAccessToken()
      if (kidToken) {
        const { data, error } = await getChildCachedChannelVideos(kidToken, youtubeChannelId)
        if (error) throw error
        return (data ?? []).map((row) => ({
          youtube_video_id: row.youtube_video_id,
          title: row.title,
          thumbnail_url: row.thumbnail_url,
          duration_seconds: row.duration_seconds ?? null,
          published_at: row.published_at ?? null,
        }))
      }

      const { data, error } = await supabase
        .from('channel_videos_cache')
        .select('youtube_video_id, title, thumbnail_url, duration_seconds, published_at, position')
        .eq('channel_id', channelKey)
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => {
        const r = row as {
          youtube_video_id: string
          title: string
          thumbnail_url: string | null
          duration_seconds?: number | null
          published_at?: string | null
        }
        return {
          youtube_video_id: r.youtube_video_id,
          title: r.title,
          thumbnail_url: r.thumbnail_url,
          duration_seconds: r.duration_seconds ?? null,
          published_at: r.published_at ?? null,
        }
      })
    }

    void (async () => {
      try {
        let rows = await fetchCachedRows()
        if (requestId !== videosLoadGenRef.current) return

        // Cache may still be filling after add — brief retry before falling back to YouTube.
        if (rows.length === 0) {
          await new Promise((r) => setTimeout(r, 250))
          if (requestId !== videosLoadGenRef.current) return
          rows = await fetchCachedRows()
        }

        if (requestId !== videosLoadGenRef.current) return

        if (rows.length === 0) {
          // Seed from YouTube (same source as cache fill) so channel switch is never stuck empty.
          const kidToken = getSavedChildAccessToken()
          if (!kidToken) {
            await refreshChannelVideosCache(channelKey, youtubeChannelId, 'initial')
            if (requestId !== videosLoadGenRef.current) return
            rows = await fetchCachedRows()
          }
          if (rows.length === 0) {
            const page = await fetchChannelUploadsPage(youtubeChannelId, { maxPages: 1 })
            if (requestId !== videosLoadGenRef.current) return
            if (page.error) {
              setVideosError(friendlyVideosError(page.error.message))
              setVideosLoading(false)
              return
            }
            const uploaded = (page.data?.videos ?? []).map((v) => ({
              youtube_video_id: v.videoId,
              title: v.title,
              thumbnail_url: v.thumbnail || null,
              duration_seconds: v.durationSeconds ?? null,
              published_at: v.publishedAt ?? null,
            }))
            // Live uploads bypass cache SQL hidden filter — apply client red line.
            const hiddenRes = kidToken
              ? await listHiddenVideoIdsForChild(kidToken)
              : deviceId
                ? await listHiddenVideoIdsForDevice(deviceId)
                : { data: new Set<string>(), error: null }
            rows = uploaded.filter((v) => !hiddenRes.data.has(v.youtube_video_id))
            if (!kidToken && rows.length > 0) {
              void refreshChannelVideosCache(channelKey, youtubeChannelId, 'initial')
            }
          }
        }

        if (requestId !== videosLoadGenRef.current) return

        const fast = mapRows(rows)
        setVideos((prev) => (channelChanged ? fast : stabilizeWatchableVideoList(prev, fast)))
        setVideosLoading(false)
        void enrichVideosWithFormat(
          rows.map((row) => ({
            youtube_video_id: row.youtube_video_id,
            title: row.title,
            thumbnail_url: row.thumbnail_url,
            durationSeconds: row.duration_seconds ?? null,
            publishedAt: row.published_at ?? null,
          }))
        ).then((enriched) => {
          if (requestId !== videosLoadGenRef.current) return
          setVideos((prev) => stabilizeWatchableVideoList(prev, enriched as typeof prev))
        })

        // Resolve YouTube-like continuation without resetting to page 1 over a filled cache.
        void resolveChannelUploadsCursor({
          youtubeChannelId,
          uploadsPlaylistId: selectedChannel?.videos_cache_uploads_playlist_id,
          knownVideoIds: rows.map((r) => r.youtube_video_id),
          storedToken: selectedChannel?.videos_cache_next_page_token,
          storedHasMore: selectedChannel?.videos_cache_has_more,
        }).then((resolved) => {
          if (requestId !== videosLoadGenRef.current || resolved.error || !resolved.data) return
          const {
            newerVideos,
            boundaryOlderVideos,
            nextPageToken,
            hasMore,
            uploadsPlaylistId,
          } = resolved.data

          const extras = [...newerVideos, ...boundaryOlderVideos]
          if (extras.length > 0) {
            setVideos((prev) => {
              const seen = new Set(prev.map((v) => v.youtube_video_id))
              const newerMapped = newerVideos
                .filter((v) => !seen.has(v.videoId))
                .map((v) =>
                  toWatchableVideo({
                    youtube_video_id: v.videoId,
                    title: v.title,
                    thumbnail_url: v.thumbnail || null,
                    duration_seconds: v.durationSeconds ?? null,
                    publishedAt: v.publishedAt ?? null,
                  })
                )
              for (const v of newerMapped) seen.add(v.youtube_video_id)
              const olderMapped = boundaryOlderVideos
                .filter((v) => !seen.has(v.videoId))
                .map((v) =>
                  toWatchableVideo({
                    youtube_video_id: v.videoId,
                    title: v.title,
                    thumbnail_url: v.thumbnail || null,
                    duration_seconds: v.durationSeconds ?? null,
                    publishedAt: v.publishedAt ?? null,
                  })
                )
              if (newerMapped.length === 0 && olderMapped.length === 0) return prev
              return [...newerMapped, ...prev, ...olderMapped]
            })
            void enrichVideosWithFormat(
              extras.map((v) => ({
                youtube_video_id: v.videoId,
                title: v.title,
                thumbnail_url: v.thumbnail || null,
                durationSeconds: v.durationSeconds ?? null,
                publishedAt: v.publishedAt ?? null,
              }))
            ).then((enriched) => {
              if (requestId !== videosLoadGenRef.current) return
              setVideos((prev) => {
                const byId = new Map(enriched.map((v) => [v.youtube_video_id, v]))
                const merged = prev.map((v) => byId.get(v.youtube_video_id) ?? v)
                return stabilizeWatchableVideoList(prev, merged as typeof prev)
              })
            })
          }

          setUploadsCursor({
            nextPageToken,
            uploadsPlaylistId: uploadsPlaylistId || selectedChannel?.videos_cache_uploads_playlist_id || null,
            hasMore: Boolean(hasMore && nextPageToken),
          })
        })

        // Background cache warm — avoid full remount when the list is already on screen.
        if (forceRefreshedChannelRef.current !== channelKey) {
          forceRefreshedChannelRef.current = channelKey
          void refreshChannelVideosCache(channelKey, youtubeChannelId, 'initial').then((result) => {
            if (requestId !== videosLoadGenRef.current) return
            if ((result.appended ?? 0) > 0 || result.hasMore) {
              setVideosReloadNonce((n) => n + 1)
            }
          })
        }
      } catch (e) {
        if (requestId !== videosLoadGenRef.current) return
        setVideosLoading(false)
        setVideosError(e instanceof Error ? friendlyVideosError(e.message) : 'טעינת סרטונים נכשלה')
      }
    })()
  }, [selectedChannelDbId, selectedYoutubeChannelId, refreshChannelVideosCache, videosReloadNonce, deviceId])

  const channelShorts = useChannelYoutubeShorts(
    selectedYoutubeChannelId,
    Boolean(selectedYoutubeChannelId) && allowShorts
  )
  const videosWithChannelShorts = useMemo(() => {
    const extras = channelShorts.videos
    if (extras.length === 0) return videos
    const extrasById = new Map(extras.map((video) => [video.youtube_video_id, video]))
    const merged = videos.map((video) => {
      const extra = extrasById.get(video.youtube_video_id)
      if (!extra) return video
      return {
        ...video,
        watchUrl: extra.watchUrl ?? video.watchUrl,
        format: 'short' as const,
      }
    })
    const seen = new Set(videos.map((video) => video.youtube_video_id))
    const fresh = extras.filter((video) => !seen.has(video.youtube_video_id))
    return fresh.length === 0 ? merged : [...fresh, ...merged]
  }, [videos, channelShorts.videos])

  const channelScopedVideos = useMemo((): ChannelWatchVideo[] => {
    if (!selectedChannel) return []
    return videosWithChannelShorts.map((video) => ({
      ...video,
      channelId: selectedChannel.id,
      youtubeChannelId: selectedChannel.youtube_channel_id,
      channelName: selectedChannel.channel_name,
    }))
  }, [videosWithChannelShorts, selectedChannel])

  const playlistSourceVideos = useMemo(
    () =>
      showMyPlaylist
        ? channelScopedVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id))
        : channelScopedVideos,
    [showMyPlaylist, channelScopedVideos, savedPlaylistIds]
  )
  const filteredVideos = useMemo(() => {
    const bySearch = filterVideosByTitle(playlistSourceVideos, videoSearch)
    const withoutUpcoming = bySearch.filter(
      (video) => !shouldHideFromChildBrowse(video.title, video.liveBroadcastContent)
    )
    return filterVideosRespectingAllowShorts(withoutUpcoming, allowShorts)
  }, [playlistSourceVideos, videoSearch, allowShorts])

  const portraitThumbnailIds = usePortraitVideoThumbnailIds(filteredVideos)

  useEffect(() => {
    setPlaybackPortraitThumbnailIds(portraitThumbnailIds)
  }, [portraitThumbnailIds])

  const handleLoadMoreChannelVideos = useCallback(async () => {
    if (!selectedYoutubeChannelId || !selectedChannelDbId || videosLoadingMore) return
    const token = uploadsCursor?.nextPageToken
    if (!token && !uploadsCursor?.hasMore) return

    setVideosLoadingMore(true)
    setVideosError(null)
    try {
      const kidToken = getSavedChildAccessToken()
      // Parent / authenticated path: append into shared cache then merge locally.
      if (!kidToken && token) {
        const appended = await appendChannelVideosCache(selectedChannelDbId, selectedYoutubeChannelId)
        if (appended.error) {
          setVideosError(friendlyVideosError(appended.error.message))
          return
        }
      }

      const page = await fetchChannelUploadsPage(selectedYoutubeChannelId, {
        maxPages: 1,
        pageToken: token,
        uploadsPlaylistId: uploadsCursor?.uploadsPlaylistId,
      })
      if (page.error || !page.data) {
        setVideosError(page.error ? friendlyVideosError(page.error.message) : 'טעינת סרטונים נוספים נכשלה')
        return
      }

      const mapped = page.data.videos.map((v) =>
        toWatchableVideo({
          youtube_video_id: v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || null,
          duration_seconds: v.durationSeconds ?? null,
          publishedAt: v.publishedAt ?? null,
        })
      )
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.youtube_video_id))
        return [...prev, ...mapped.filter((v) => !seen.has(v.youtube_video_id))]
      })
      void enrichVideosWithFormat(
        mapped.map((v) => ({
          youtube_video_id: v.youtube_video_id,
          title: v.title,
          thumbnail_url: v.thumbnail_url,
          durationSeconds: v.durationSeconds,
          publishedAt: v.publishedAt ?? null,
        }))
      ).then((enriched) => {
        setVideos((prev) => {
          const byId = new Map(enriched.map((v) => [v.youtube_video_id, v]))
          const merged = prev.map((v) => byId.get(v.youtube_video_id) ?? v)
          return stabilizeWatchableVideoList(prev, merged as typeof prev)
        })
      })

      setUploadsCursor({
        nextPageToken: page.data.nextPageToken,
        uploadsPlaylistId: page.data.uploadsPlaylistId || uploadsCursor?.uploadsPlaylistId || null,
        hasMore: Boolean(page.data.hasMore && page.data.nextPageToken),
      })
    } finally {
      setVideosLoadingMore(false)
    }
  }, [
    selectedYoutubeChannelId,
    selectedChannelDbId,
    videosLoadingMore,
    uploadsCursor,
    appendChannelVideosCache,
  ])

  const channelHasMoreVideos = Boolean(uploadsCursor?.hasMore)
  const channelSearchDropdownItems = useMemo(
    () =>
      filteredVideos.map((video) => ({
        id: video.youtube_video_id,
        title: video.title,
        thumbnail: video.thumbnail_url ?? null,
      })),
    [filteredVideos]
  )
  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null
    const fromChannel = channelScopedVideos.find((video) => video.youtube_video_id === activeVideoId)
    if (fromChannel) return fromChannel
    if (playingVideo?.youtube_video_id === activeVideoId) return playingVideo
    return null
  }, [channelScopedVideos, activeVideoId, playingVideo])
  const playerNavQueue = useMemo(
    () => buildShortsAwareNavQueue(filteredVideos, activeVideo ?? playingVideo),
    [filteredVideos, activeVideo, playingVideo]
  )
  const playerNavIndex = useMemo(
    () => playerNavQueue.findIndex((video) => video.youtube_video_id === activeVideoId),
    [playerNavQueue, activeVideoId]
  )
  const hasNextVideo = playerNavIndex >= 0 && playerNavIndex < playerNavQueue.length - 1
  const playlistCountInChannel = useMemo(
    () => channelScopedVideos.filter((video) => savedPlaylistIds.has(video.youtube_video_id)).length,
    [channelScopedVideos, savedPlaylistIds]
  )

  const shortsLaneFeed = useMemo(() => {
    if (!selectedChannel || !allowShorts) return []
    const shortsIds = new Set(
      channelShorts.items.filter((item) => item.fromShortsPlaylist).map((item) => item.videoId)
    )
    const feed = filteredVideos
      .filter((video) => {
        const fromShortsPlaylist =
          shortsIds.has(video.youtube_video_id) || Boolean(video.watchUrl?.includes('/shorts/'))
        return (
          fromShortsPlaylist ||
          shouldRouteToShortsLane(
            {
              title: video.title,
              durationSeconds: video.durationSeconds ?? null,
              youtubeVideoId: video.youtube_video_id,
              thumbnail_url: video.thumbnail_url,
              watchUrl: video.watchUrl ?? buildYoutubeWatchUrl(video.youtube_video_id),
              format: video.format,
            },
            portraitThumbnailIds
          )
        )
      })
      .map((video) =>
        buildShortsLaneItem({
          videoId: video.youtube_video_id,
          title: video.title,
          thumbnail: video.thumbnail_url,
          youtubeChannelId: selectedChannel.youtube_channel_id,
          channelName: selectedChannel.channel_name,
          channelThumbnail: selectedChannel.channel_thumbnail,
          durationSeconds: video.durationSeconds ?? null,
          publishedAt: video.publishedAt ?? null,
        })
      )
    if (
      shortsLaneSeedVideoId &&
      !feed.some((item) => item.videoId === shortsLaneSeedVideoId)
    ) {
      const seed = videosWithChannelShorts.find((video) => video.youtube_video_id === shortsLaneSeedVideoId)
      if (seed) {
        feed.unshift(
          buildShortsLaneItem({
            videoId: seed.youtube_video_id,
            title: seed.title,
            thumbnail: seed.thumbnail_url,
            youtubeChannelId: selectedChannel.youtube_channel_id,
            channelName: selectedChannel.channel_name,
            channelThumbnail: selectedChannel.channel_thumbnail,
            durationSeconds: seed.durationSeconds ?? null,
            publishedAt: seed.publishedAt ?? null,
          })
        )
      }
    }
    return feed
  }, [
    filteredVideos,
    selectedChannel,
    allowShorts,
    portraitThumbnailIds,
    channelShorts.items,
    shortsLaneSeedVideoId,
    videosWithChannelShorts,
  ])

  const shortsLaneSeedIndex = useMemo(() => {
    if (!shortsLaneSeedVideoId) return 0
    const idx = shortsLaneFeed.findIndex((item) => item.videoId === shortsLaneSeedVideoId)
    return idx >= 0 ? idx : 0
  }, [shortsLaneFeed, shortsLaneSeedVideoId])

  const exitShortsSession = useCallback(() => {
    const ctx = browseNavContextRef.current
    browseNavContextRef.current = null
    setShortsLaneOpen(false)
    setShortsLaneSeedVideoId(null)
    if (ctx) {
      const nextTab: ChannelContentTab =
        ctx.channelContentTab === 'shorts' ? 'home' : (ctx.channelContentTab as ChannelContentTab)
      setChannelContentTab(nextTab)
      setActiveVideoId(ctx.priorActiveVideoId)
      setWatchStarted(Boolean(ctx.watchStarted && ctx.priorActiveVideoId))
      restoreBrowseScroll(ctx.scrollY)
    } else {
      if (channelContentTab === 'shorts') setChannelContentTab('home')
      setWatchStarted(false)
    }
  }, [channelContentTab])

  const exitWatchSession = useCallback(() => {
    const ctx = browseNavContextRef.current
    browseNavContextRef.current = null
    setActiveVideoId(null)
    setPlayingVideo(null)
    setWatchStarted(false)
    setShortsLaneOpen(false)
    setShortsLaneSeedVideoId(null)
    if (ctx) {
      const nextTab: ChannelContentTab =
        ctx.channelContentTab === 'shorts' ? 'home' : (ctx.channelContentTab as ChannelContentTab)
      setChannelContentTab(nextTab)
      restoreBrowseScroll(ctx.scrollY)
    }
  }, [])

  const openShortsLane = useCallback(
    (videoId: string) => {
      if (!shortsLaneOpen) {
        browseNavContextRef.current = captureBrowseNavContext({
          channelContentTab,
          priorActiveVideoId: null,
          watchStarted: false,
        })
      }
      const video = videosWithChannelShorts.find((v) => v.youtube_video_id === videoId)
      setPlaybackContentShape('short')
      setPlaybackPresentationContext({
        youtubeVideoId: videoId,
        thumbnail_url: video?.thumbnail_url ?? null,
        fromShortsPlaylist: Boolean(
          channelShorts.items.some((item) => item.videoId === videoId && item.fromShortsPlaylist) ||
            video?.watchUrl?.includes('/shorts/')
        ),
      })
      setPlaybackPresentationShape(
        inferPresentationShape({
          youtubeVideoId: videoId,
          thumbnail_url: video?.thumbnail_url ?? null,
          fromShortsPlaylist: Boolean(
            channelShorts.items.some((item) => item.videoId === videoId && item.fromShortsPlaylist) ||
              video?.watchUrl?.includes('/shorts/')
          ),
          contentShape: 'short',
          portraitThumbnailIds,
        })
      )
      setShortsLaneSeedVideoId(videoId)
      setShortsLaneOpen(true)
      setActiveVideoId(videoId)
      setWatchStarted(false)
    },
    [shortsLaneOpen, channelContentTab, videosWithChannelShorts, channelShorts.items, portraitThumbnailIds]
  )

  const { handlePlayerBack } = usePlayerOwnedBackNavigation({
    enabled: true,
    isShortsOpen: shortsLaneOpen,
    isWatchOpen: Boolean(watchStarted && activeVideoId) && !shortsLaneOpen,
    onExitShorts: exitShortsSession,
    onExitWatch: exitWatchSession,
  })

  const handleCloseShortsLane = useCallback(() => {
    if (shortsLaneOpen) handlePlayerBack()
    else exitShortsSession()
  }, [shortsLaneOpen, handlePlayerBack, exitShortsSession])

  const handleChannelContentTabChange = useCallback(
    (tab: ChannelContentTab) => {
      setChannelContentTab(tab)
      if (tab !== 'shorts' && shortsLaneOpen) {
        handleCloseShortsLane()
      }
    },
    [shortsLaneOpen, handleCloseShortsLane]
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
    (input: string | WatchableVideoBase | ChannelWatchVideo, playAs?: 'short' | 'long') => {
      let videoId: string
      let snapshot: ChannelWatchVideo | null = null

      if (typeof input === 'string') {
        videoId = input
        const base = videosWithChannelShorts.find((video) => video.youtube_video_id === videoId) ?? null
        if (base) snapshot = toChannelWatchVideo(base)
      } else if ('channelName' in input) {
        videoId = input.youtube_video_id
        snapshot = input
      } else {
        videoId = input.youtube_video_id
        snapshot = toChannelWatchVideo(input)
      }

      void (async () => {
        if (childRuntime?.isBlocked) return

        const gateTarget = snapshot ?? videosWithChannelShorts.find((v) => v.youtube_video_id === videoId) ?? null
        if (
          gateTarget &&
          isShortsBlockedForProfile(allowShorts, {
            title: gateTarget.title,
            durationSeconds: gateTarget.durationSeconds,
            youtubeVideoId: gateTarget.youtube_video_id,
            thumbnail_url: gateTarget.thumbnail_url,
            format: gateTarget.format,
          })
        ) {
          toast.error(t('kid.shortsBlocked'))
          return
        }
        if (gateTarget && shouldHideFromChildBrowse(gateTarget.title, gateTarget.liveBroadcastContent)) {
          toast.error(t('kid.contentUnavailable'))
          return
        }

        if (
          allowShorts &&
          playAs !== 'long' &&
          gateTarget &&
          (playAs === 'short' ||
            shouldRouteToShortsLane(
              {
                title: gateTarget.title,
                durationSeconds: gateTarget.durationSeconds ?? null,
                youtubeVideoId: videoId,
                thumbnail_url: gateTarget.thumbnail_url,
                watchUrl: gateTarget.watchUrl ?? buildYoutubeWatchUrl(videoId),
                format: gateTarget.format,
              },
              portraitThumbnailIds
            ) ||
            Boolean(
              channelShorts.items.some((item) => item.videoId === videoId && item.fromShortsPlaylist) ||
                gateTarget.watchUrl?.includes('/shorts/')
            ))
        ) {
          if (snapshot) setPlayingVideo(snapshot)
          openShortsLane(videoId)
          return
        }

        if (snapshot) setPlayingVideo(snapshot)
        const shape = classifyContentShape({
          durationSeconds: snapshot?.durationSeconds ?? gateTarget?.durationSeconds ?? null,
          youtubeVideoId: videoId,
          title: snapshot?.title ?? gateTarget?.title,
          thumbnail: snapshot?.thumbnail_url ?? gateTarget?.thumbnail_url,
        })
        setPlaybackFormat(shape)
        setPlaybackContentShape(shape)
        const fromShortsPlaylist = Boolean(
          channelShorts.items.some((item) => item.videoId === videoId && item.fromShortsPlaylist) ||
            gateTarget?.watchUrl?.includes('/shorts/')
        )
        setPlaybackPresentationContext({
          youtubeVideoId: videoId,
          thumbnail_url: snapshot?.thumbnail_url ?? gateTarget?.thumbnail_url ?? null,
          fromShortsPlaylist,
        })
        setPlaybackPresentationShape(
          inferPresentationShape({
            youtubeVideoId: videoId,
            thumbnail_url: snapshot?.thumbnail_url ?? gateTarget?.thumbnail_url ?? null,
            fromShortsPlaylist,
            contentShape: shape,
            portraitThumbnailIds,
          })
        )
        logPlaybackStreamRequest(videoId, 'ChannelsPage.selectWatchVideo (play tap)')
        if (!watchStarted && !shortsLaneOpen) {
          browseNavContextRef.current = captureBrowseNavContext({
            channelContentTab,
            priorActiveVideoId: null,
            watchStarted: false,
          })
        }
        setWatchStarted(true)
        setActiveVideoId(videoId)
      })()
    },
    [
      videosWithChannelShorts,
      toChannelWatchVideo,
      childRuntime,
      allowShorts,
      openShortsLane,
      t,
      watchStarted,
      shortsLaneOpen,
      channelContentTab,
      portraitThumbnailIds,
      channelShorts.items,
    ]
  )

  /** Refresh presentation when async portrait thumbnail probe completes (expand-only axis). */
  useEffect(() => {
    if (!activeVideoId) return
    const gateTarget = videosWithChannelShorts.find((v) => v.youtube_video_id === activeVideoId) ?? null
    if (!gateTarget) return
    const fromShortsPlaylist = Boolean(
      channelShorts.items.some((item) => item.videoId === activeVideoId && item.fromShortsPlaylist) ||
        gateTarget.watchUrl?.includes('/shorts/')
    )
    setPlaybackPresentationShape(
      inferPresentationShape({
        youtubeVideoId: activeVideoId,
        thumbnail_url: gateTarget.thumbnail_url,
        fromShortsPlaylist,
        contentShape: playbackFormat,
        portraitThumbnailIds,
      })
    )
  }, [activeVideoId, playbackFormat, videosWithChannelShorts, portraitThumbnailIds, channelShorts.items])

  useEffect(() => {
    if (!watchStarted || !activeVideoId || shortsLaneOpen) return
    scrollPlayerIntoViewForWatch(playerAnchorRef.current)
  }, [watchStarted, activeVideoId, shortsLaneOpen])

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
          : 'border-yt-border bg-yt-surfaceHover text-yt-text hover:bg-yt-surfaceHover'
      }`}
      title={savedPlaylistIds.has(videoId) ? t('playlists.removeFromMine') : t('playlists.addToMine')}
      aria-label={
        savedPlaylistIds.has(videoId)
          ? t('playlists.removeFromMineAria', { title })
          : t('playlists.addToMineAria', { title })
      }
    >
      {savedPlaylistIds.has(videoId) ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
    </button>
  )

  const goNextVideo = useCallback(() => {
    if (!hasNextVideo || playerNavIndex < 0) return
    selectWatchVideo(playerNavQueue[playerNavIndex + 1]!)
  }, [hasNextVideo, playerNavQueue, playerNavIndex, selectWatchVideo])

  const goPreviousVideo = useCallback(() => {
    if (playerNavIndex <= 0) return
    selectWatchVideo(playerNavQueue[playerNavIndex - 1]!)
  }, [playerNavIndex, playerNavQueue, selectWatchVideo])

  const openChannel = (youtubeChannelId: string) => {
    if (deviceId) saveActiveChildProfileId(deviceId)
    setChannelContentTab('home')
    // Leave watch/shorts so the prior video does not stay visually dominant.
    setWatchStarted(false)
    setActiveVideoId(null)
    setPlayingVideo(null)
    setShortsLaneOpen(false)
    setShortsLaneSeedVideoId(null)
    discardPlayerHistoryLayerQuietly()
    pendingChannelEnterScrollRef.current = true
    const next = new URLSearchParams(searchParams)
    if (deviceId) next.set('device', deviceId)
    next.set('channel', youtubeChannelId)
    navigate({ pathname: '/channels', search: `?${next.toString()}` })
    // Same-channel re-enter: section already mounted — scroll now.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!pendingChannelEnterScrollRef.current) return
        const el = channelContentRef.current
        if (!el) return
        pendingChannelEnterScrollRef.current = false
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  useEffect(() => {
    if (!pendingChannelEnterScrollRef.current || !selectedChannelDbId) return
    pendingChannelEnterScrollRef.current = false
    window.requestAnimationFrame(() => {
      const el = channelContentRef.current
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }, [selectedChannelDbId])

  const requestRemoveChannel = useCallback((channel: WhitelistedChannel) => {
    if (isParentManagementSessionVerified()) {
      setRemoveTarget(channel)
      return
    }
    pendingRemoveRef.current = channel
    setPinPurpose('remove')
    setPinOpen(true)
  }, [])

  const requestOpenChannelSearch = useCallback(() => {
    if (isParentManagementSessionVerified()) {
      setChannelSearchOpen(true)
      return
    }
    pendingRemoveRef.current = null
    setPinPurpose('add')
    setPinOpen(true)
  }, [])

  const handleAddChannelFromSearch = useCallback(
    async (yt: YouTubeChannelResult, opts?: { silentSuccess?: boolean }): Promise<boolean> => {
      setAddedSearchChannelIds((prev) => new Set(prev).add(yt.channelId))
      setAddingSearchChannelId(null)
      const { error } = await addToWhitelist(yt, null)
      if (error) {
        setAddedSearchChannelIds((prev) => {
          const next = new Set(prev)
          next.delete(yt.channelId)
          return next
        })
        toast.error(error.message)
        return false
      }
      if (!opts?.silentSuccess) {
        setChannelAddSuccessName(yt.title)
        setChannelAddSuccessCount(1)
        setChannelAddSuccessOpen(true)
      }
      return true
    },
    [addToWhitelist]
  )

  const handleAddChannelsFromSearch = useCallback(
    async (list: YouTubeChannelResult[]) => {
      let ok = 0
      let lastName: string | null = null
      for (const yt of list) {
        const added = await handleAddChannelFromSearch(yt, { silentSuccess: true })
        if (added) {
          ok += 1
          lastName = yt.title
        }
      }
      if (ok > 0) {
        setChannelAddSuccessName(ok === 1 ? lastName : null)
        setChannelAddSuccessCount(ok)
        setChannelAddSuccessOpen(true)
      }
    },
    [handleAddChannelFromSearch]
  )

  const confirmRemoveChannel = useCallback(async () => {
    if (!removeTarget) return
    setRemoveLoading(true)
    const { error } = await removeFromWhitelist(removeTarget.id)
    setRemoveLoading(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success(t('channels.removed'))
    const removedYt = removeTarget.youtube_channel_id
    const removedId = removeTarget.id
    setRemoveTarget(null)
    if (requestedChannelId === removedYt || requestedChannelId === removedId) {
      const next = new URLSearchParams(searchParams)
      next.delete('channel')
      navigate({ pathname: '/channels', search: next.toString() ? `?${next.toString()}` : '' })
    }
  }, [removeTarget, removeFromWhitelist, requestedChannelId, searchParams, navigate, t])

  const verifyRemovePin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: {
            isActive: Boolean(childAccessToken),
            pin: readLocalParentSession()?.pin ?? null,
          },
        },
        pin
      ),
    [user?.id, profile, childAccessToken]
  )

  const goHome = () => {
    setWatchStarted(false)
    const next = new URLSearchParams(searchParams)
    next.delete('channel')
    navigate({ pathname: '/channels', search: next.toString() ? `?${next.toString()}` : '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const showChannelsNav =
    !devicesLoading && !loading && devices.length > 0 && visibleChannels.length > 0

  useEffect(() => {
    if (!childRuntime?.playbackBlocked) return
    setWatchStarted(false)
    setActiveVideoId(null)
    setPlayingVideo(null)
  }, [childRuntime?.playbackBlocked])

  const showLionProfile = Boolean(getSavedChildAccessToken())
  const childBlocked = Boolean(childRuntime?.isBlocked)

  if (childBlocked && getSavedChildAccessToken()) {
    return (
      <section className="mx-auto max-w-lg px-4 py-10">
        <div className="rounded-2xl border border-danger-700/50 bg-gradient-to-b from-danger-900/30 to-danger-950/80 p-8 text-center text-danger-100 shadow-inner">
          <ShieldAlert className="mx-auto mb-3 h-12 w-12 opacity-90" aria-hidden />
          <h2 className="text-xl font-black tracking-tight">הצפייה חסומה</h2>
          <p className="mt-3 text-sm leading-relaxed opacity-95">
            ההורה חסם את הצפייה כרגע. בקשו לפתוח — או עברו ללשונית <strong>הורים</strong>.
          </p>
        </div>
      </section>
    )
  }

  return (
    <ScreenTimeChildGate>
    <LionProgressionProvider>
    <DailyWatchBudgetTracker deviceId={deviceId} />
    <div
      ref={channelsShellRef}
      className={`mx-auto flex w-full max-w-[100vw] flex-col gap-3 overflow-x-clip pb-4 xs:gap-4 ${
        selectedChannel ? 'lg:max-w-[1754px]' : 'max-w-5xl xl:max-w-6xl'
      }`}
    >
      <header
        ref={channelsPageChromeRef}
        className={`${
          isWatching ? 'relative z-20' : 'sticky-under-chrome sticky z-20'
        } rounded-2xl border border-yt-border bg-yt-surface p-3 shadow-2xl shadow-black/15 xs:rounded-3xl xs:p-4 sm:p-5`}
      >
        <div className="flex min-w-0 items-center gap-2 xs:gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25 xs:h-12 xs:w-12">
            <Tv className="h-6 w-6 xs:h-7 xs:w-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black text-yt-text xs:text-xl">
              {selectedChannel ? selectedChannel.channel_name : t('channels.approvedChannelsHeading')}
            </h1>
          </div>
          <Button
            type="button"
            className="shrink-0 gap-1.5 rounded-full !px-3 text-xs font-bold xs:text-sm"
            onClick={() => requestOpenChannelSearch()}
          >
            <Search className="h-4 w-4" aria-hidden />
            {t('kid.addChannelsShort')}
          </Button>
          {showLionProfile ? <LionProfileButton /> : null}
        </div>
        {showChannelsNav ? (
          <ChildChannelsNavCarousel
            channels={visibleChannels}
            activeYoutubeChannelId={selectedChannel?.youtube_channel_id ?? null}
            onSelectChannel={openChannel}
            onRemoveChannel={requestRemoveChannel}
            className="md:hidden"
          />
        ) : null}
        {selectedChannel ? (
          <div className="mt-3 border-t border-yt-border pt-3 xs:mt-4 xs:pt-4">
            <ChannelVideoSearchBar
              id="child-channel-video-search"
              value={videoSearch}
              onChange={setVideoSearch}
              totalCount={playlistSourceVideos.length}
              filteredCount={filteredVideos.length}
              channelLabel={selectedChannel.channel_name}
              className="rounded-2xl border border-yt-border bg-yt-surface p-2.5 shadow-inner shadow-black/20 xs:p-3"
              dropdownResults={channelSearchDropdownItems}
              activeResultId={activeVideoId}
              onSelectResult={(videoId) => selectWatchVideo(videoId)}
              dropdownLoading={videosLoading}
            />
            {/* Browse tabs live in this sticky header so they cannot paint over the video grid. */}
            {!(watchStarted && activeVideoId) ? (
              <div className="mt-2">
                <ChannelContentTabs
                  value={channelContentTab}
                  onChange={handleChannelContentTabChange}
                  allowShorts={allowShorts}
                  appearance="underline"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {devicesLoading || loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 rounded-3xl border border-yt-border bg-yt-bg text-yt-textMuted">
          <LoadingSpinner className="h-8 w-8 border-2 border-sky-400 border-t-transparent" />
          {t('channels.loadingChannels')}
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-yt-border bg-yt-bg px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-yt-textMuted" aria-hidden />
          <p className="font-semibold text-yt-textMuted">{t('channels.noProfilesYet')}</p>
        </div>
      ) : visibleChannels.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-yt-border bg-yt-bg px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-yt-textMuted" aria-hidden />
          <p className="font-semibold text-yt-textMuted">{t('channels.noApprovedYet')}</p>
          <p className="mt-1 text-sm text-yt-text0">{t('kid.addChannelsQuickHint')}</p>
          <Button
            type="button"
            className="mt-4 min-h-12 gap-2 rounded-xl text-sm font-bold"
            onClick={() => requestOpenChannelSearch()}
          >
            <Search className="h-5 w-5" aria-hidden />
            {t('kid.addChannelsSearch')}
          </Button>
        </div>
      ) : selectedChannel ? (
        <div className="flex min-w-0 flex-col gap-4 md:grid md:grid-cols-[minmax(180px,220px)_minmax(0,1fr)] md:items-start lg:grid-cols-[minmax(200px,240px)_minmax(0,1fr)]">
          <aside className="sticky top-[calc(var(--chrome-top)+var(--chrome-page-top))] hidden max-h-[calc(100dvh-var(--chrome-top)-var(--chrome-page-top))] overflow-y-auto rounded-2xl border border-yt-border bg-yt-surface p-2 md:block">
            <button
              type="button"
              onClick={goHome}
              className="mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-sm font-semibold text-yt-textMuted transition hover:bg-yt-surfaceHover"
            >
              {t('channels.channelsHome')}
            </button>
            <div className="mb-1 flex items-center justify-between gap-1 px-1">
              <p className="px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-yt-text0">
                {t('channels.channelsLabel')}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="!min-h-8 shrink-0 !rounded-full !px-2.5 !py-1 text-[11px] font-bold"
                onClick={() => requestOpenChannelSearch()}
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                {t('kid.addChannelsShort')}
              </Button>
            </div>
            <div className="flex flex-col gap-0.5">
              {visibleChannels.map((channel) => {
                const active = channel.youtube_channel_id === selectedChannel.youtube_channel_id
                return (
                  <div
                    key={channel.id}
                    className={`flex items-center gap-0.5 rounded-xl ${
                      active ? 'bg-yt-surfaceHover text-yt-text' : 'text-yt-textMuted'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => openChannel(channel.youtube_channel_id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-start transition hover:bg-yt-surfaceHover hover:text-yt-text"
                    >
                      {channel.channel_thumbnail ? (
                        <img
                          src={channel.channel_thumbnail}
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yt-surfaceHover">
                          <Tv className="h-4 w-4" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 truncate text-sm font-medium">{channel.channel_name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestRemoveChannel(channel)}
                      className="me-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-400 transition hover:bg-red-950/40"
                      aria-label={t('channels.removeAria', { name: channel.channel_name })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>
        <section
          ref={channelContentRef}
          className="min-w-0 max-w-full scroll-mt-chrome overflow-x-clip rounded-none border-0 bg-transparent p-0 shadow-none sm:rounded-3xl sm:border sm:border-yt-border sm:bg-yt-surface sm:p-4 sm:shadow-xl sm:shadow-black/10"
        >
          {videosError ? (
            <p className="rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {videosError}
            </p>
          ) : watchStarted && activeVideoId ? (
            <YoutubeWatchLayout
              className="px-0 pb-2"
              main={
                <div className="flex w-full min-w-0 flex-col">
                  <div ref={playerAnchorRef} className="scroll-mt-chrome w-full" data-safetube-player>
                    <ChildWatchPlayerShell
                      videoId={activeVideoId}
                      title={activeVideo?.title ?? playingVideo?.title ?? t('common.loading')}
                      channelTitle={activeVideo?.channelName ?? playingVideo?.channelName ?? selectedChannel.channel_name}
                      posterUrl={activeVideo?.thumbnail_url ?? playingVideo?.thumbnail_url ?? null}
                      blankVideoFrame={false}
                      format={playbackFormat}
                      durationSeconds={activeVideo?.durationSeconds ?? playingVideo?.durationSeconds ?? null}
                      onPreviousTrack={goPreviousVideo}
                      onNextTrack={goNextVideo}
                      hasNextTrack={hasNextVideo}
                      onMiniDismiss={exitWatchSession}
                      onBack={handlePlayerBack}
                    />
                  </div>
                  <YoutubeWatchVideoDetails
                    title={activeVideo?.title ?? playingVideo?.title ?? t('common.loading')}
                    channelName={
                      activeVideo?.channelName ?? playingVideo?.channelName ?? selectedChannel.channel_name
                    }
                    channelThumbnail={selectedChannel.channel_thumbnail ?? null}
                    subtitle={
                      joinVideoMetadataParts(
                        formatViewCountLabel(activeVideo?.viewCount ?? playingVideo?.viewCount),
                        formatRelativePublishedAt(
                          activeVideo?.publishedAt ?? playingVideo?.publishedAt
                        )
                      )
                    }
                    actions={
                      <>
                        <YoutubeLikeButton
                          videoId={activeVideoId}
                          likeCount={activeVideo?.likeCount ?? playingVideo?.likeCount}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-9 gap-2 rounded-full !border-0 bg-yt-surfaceHover !px-3.5 !py-0 text-sm font-semibold text-yt-text hover:bg-[#3f3f3f]/80"
                          onClick={() => togglePlaylistVideo(activeVideoId)}
                        >
                          {savedPlaylistIds.has(activeVideoId) ? (
                            <Check className="h-4 w-4" aria-hidden />
                          ) : (
                            <Bookmark className="h-4 w-4" aria-hidden />
                          )}
                          {savedPlaylistIds.has(activeVideoId) ? 'נשמר' : 'שמירה'}
                        </Button>
                      </>
                    }
                  />
                  {/* Watch composition: player → details → tabs (normal flow only) → related. */}
                  <div className="safetube-watch-tabs mt-1 bg-yt-bg sm:bg-yt-surface">
                    <ChannelContentTabs
                      value={channelContentTab}
                      onChange={handleChannelContentTabChange}
                      allowShorts={allowShorts}
                      appearance="underline"
                    />
                  </div>
                </div>
              }
              sidebar={
                <div className="flex flex-col gap-3 px-1 sm:px-0">
                  <div className="rounded-2xl border border-yt-border bg-yt-surface p-2">
                    <button
                      type="button"
                      onClick={() => setShowMyPlaylist((current) => !current)}
                      aria-pressed={showMyPlaylist}
                      className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition ${
                        showMyPlaylist
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-950/30'
                          : 'bg-yt-surfaceHover text-yt-text hover:bg-yt-surfaceHover'
                      }`}
                    >
                      <ListMusic className="h-4 w-4" aria-hidden />
                      הפלייליסט שלי
                      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px]">
                        {playlistCountInChannel}
                      </span>
                    </button>
                  </div>
                  {filteredVideos.length === 0 && videoSearch.trim() ? (
                    <p className="rounded-2xl border border-dashed border-yt-border px-4 py-10 text-center text-sm text-yt-textMuted">
                      {t('channels.noSearchMatch', { q: videoSearch.trim() })}
                    </p>
                  ) : (
                    <ChannelVideoBrowseRows
                      videos={filteredVideos}
                      activeVideoId={activeVideoId}
                      allowShorts={allowShorts}
                      hideThumbnails={false}
                      channelName={selectedChannel.channel_name}
                      variant="sidebar"
                      tab={channelContentTab}
                      onTabChange={handleChannelContentTabChange}
                      hideTabs
                      onSelectVideo={selectWatchVideo}
                      hasMore={!videoSearch.trim() && !showMyPlaylist && channelHasMoreVideos}
                      loadingMore={videosLoadingMore || (channelContentTab === 'shorts' && channelShorts.loading)}
                      onLoadMore={() => void handleLoadMoreChannelVideos()}
                      renderAction={(video) => renderPlaylistAction(video.youtube_video_id, video.title)}
                      youtubeChannelId={selectedYoutubeChannelId}
                    />
                  )}
                </div>
              }
            />
          ) : videosLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-yt-textMuted">
              <LoadingSpinner className="h-7 w-7 border-2 border-sky-400 border-t-transparent" />
              טוען סרטונים…
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-yt-border px-4 py-10 text-center text-sm text-yt-textMuted">
              <p>{videosError ? videosError : 'אין סרטונים זמינים בערוץ הזה כרגע.'}</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={() => {
                  loadedChannelKeyRef.current = null
                  setVideosReloadNonce((n) => n + 1)
                }}
              >
                רענון רשימת סרטונים
              </Button>
            </div>
          ) : (
            <>
              {filteredVideos.length === 0 && videoSearch.trim() ? (
                <p className="rounded-2xl border border-dashed border-yt-border px-4 py-10 text-center text-sm text-yt-textMuted">
                  {t('channels.noSearchMatch', { q: videoSearch.trim() })}
                </p>
              ) : (
                <ChannelVideoBrowseRows
                  videos={filteredVideos}
                  activeVideoId={activeVideoId}
                  allowShorts={allowShorts}
                  hideThumbnails={false}
                  onSelectVideo={selectWatchVideo}
                  hasMore={!videoSearch.trim() && !showMyPlaylist && channelHasMoreVideos}
                  loadingMore={videosLoadingMore || (channelContentTab === 'shorts' && channelShorts.loading)}
                  onLoadMore={() => void handleLoadMoreChannelVideos()}
                  renderAction={(video) => renderPlaylistAction(video.youtube_video_id, video.title)}
                  youtubeChannelId={selectedYoutubeChannelId}
                  tab={channelContentTab}
                  onTabChange={handleChannelContentTabChange}
                  hideTabs
                />
              )}
            </>
          )}
        </section>
        </div>
      ) : (
        <>
        <section
          aria-label={t('channels.approvedCount', { count: visibleChannels.length })}
          className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-2 xs:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        >
          {visibleChannels.map((channel) => (
            <ChannelHomeCard
              key={channel.id}
              channel={channel}
              onOpen={() => openChannel(channel.youtube_channel_id)}
              onRemove={() => requestRemoveChannel(channel)}
            />
          ))}
        </section>
        </>
      )}
    </div>

    <RemoveChannelModal
      open={Boolean(removeTarget)}
      channel={removeTarget}
      onClose={() => setRemoveTarget(null)}
      onConfirm={() => void confirmRemoveChannel()}
      loading={removeLoading}
    />

    <TopicDiscoveryModal
      open={channelSearchOpen}
      onClose={() => {
        setChannelSearchOpen(false)
        setAddedSearchChannelIds(new Set())
        setAddingSearchChannelId(null)
      }}
      onAddChannel={(c) => void handleAddChannelFromSearch(c)}
      onAddChannels={(list) => void handleAddChannelsFromSearch(list)}
      onRemoveChannel={(ytId) => {
        const channel = visibleChannels.find((c) => c.youtube_channel_id === ytId)
        if (channel) requestRemoveChannel(channel)
      }}
      addingId={addingSearchChannelId}
      addedIds={addedSearchChannelIds}
      whitelistedChannelIds={new Set(visibleChannels.map((c) => c.youtube_channel_id))}
      deviceLabel={selectedDevice?.name}
    />

    <ChannelAddedSuccessModal
      open={channelAddSuccessOpen}
      channelName={channelAddSuccessName}
      addedCount={channelAddSuccessCount}
      onContinueAdding={() => {
        setChannelAddSuccessOpen(false)
        setChannelSearchOpen(true)
      }}
      onGoToChannelsList={() => {
        setChannelAddSuccessOpen(false)
        setChannelSearchOpen(false)
        setAddedSearchChannelIds(new Set())
        setAddingSearchChannelId(null)
        goHome()
      }}
    />

    <ParentalPinModal
      open={pinOpen}
      onClose={() => {
        setPinOpen(false)
        pendingRemoveRef.current = null
        setPinPurpose(null)
      }}
      verifyPin={verifyRemovePin}
      onVerified={(pin) => {
        const trimmed = pin.replace(/\D/g, '').trim()
        localParentPinRef.current = trimmed
        setParentPinSession(trimmed)
        setPinOpen(false)
        const pending = pendingRemoveRef.current
        const purpose = pinPurpose
        pendingRemoveRef.current = null
        setPinPurpose(null)
        if (purpose === 'remove' && pending) {
          setRemoveTarget(pending)
          return
        }
        if (purpose === 'add') setChannelSearchOpen(true)
      }}
      title={pinPurpose === 'add' ? t('kid.addChannelsSearch') : t('channels.removePinTitle')}
      description={
        pinPurpose === 'add' ? t('kid.addChannelsQuickHint') : t('channels.removePinBody')
      }
    />

    {shortsLaneOpen && shortsLaneFeed.length > 0 ? (
      <KidShortsLane
        feed={shortsLaneFeed}
        initialIndex={shortsLaneSeedIndex}
        hideThumbnails={false}
        onClose={handleCloseShortsLane}
        onVideoChange={(videoId) => setActiveVideoId(videoId)}
      />
    ) : null}
    </LionProgressionProvider>
    </ScreenTimeChildGate>
  )
}

export function ChannelsPage() {
  return (
    <ChildRuntimeProvider>
      <ChannelsPageInner />
    </ChildRuntimeProvider>
  )
}
