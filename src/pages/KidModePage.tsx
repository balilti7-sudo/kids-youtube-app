import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ListMusic, Play, Search, ShieldAlert, Smartphone, Unplug, Users } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { ChannelVideoSearchBar } from '../components/kid/ChannelVideoSearchBar'
import { ChannelVideoBrowseRows } from '../components/kid/ChannelVideoBrowseRows'
import { ChildWatchPlayerShell } from '../components/kid/ChildWatchPlayerShell'
import { KidGlobalSearchSection } from '../components/kid/KidGlobalSearchSection'
import { YoutubeWatchLayout } from '../components/youtube/YoutubeWatchLayout'
import { YoutubeWatchVideoDetails } from '../components/youtube/YoutubeWatchVideoDetails'
import { YoutubeLikeButton } from '../components/youtube/YoutubeLikeButton'
import { KidPlaylistView } from '../components/kid/KidPlaylistView'
import { AddToPlaylistButton } from '../components/playlists/AddToPlaylistButton'
import { AddToPlaylistModal } from '../components/playlists/AddToPlaylistModal'
import {
  PlaylistMultiSelectToolbar,
  PlaylistSelectCheckbox,
} from '../components/playlists/PlaylistMultiSelectToolbar'
import { useVideoMultiSelect } from '../hooks/useVideoMultiSelect'
import { useIdMultiSelect } from '../hooks/useIdMultiSelect'
import type { PlaylistVideoPayload } from '../lib/playlists'
import { collectCachedVideosForChildChannels } from '../lib/collectCachedChannelVideos'
import { toast } from 'sonner'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Modal } from '../components/ui/Modal'
import { useAuth } from '../hooks/useAuth'
import {
  childMarkOffline,
  clearChildAccessToken,
  getChildAllowedChannels,
  getChildCachedChannelVideos,
  getChildDeviceState,
  getSavedChildAccessToken,
  type ChildAllowedChannel,
  type ChildDeviceState,
} from '../lib/childDevice'
import { startKidModeForProfile } from '../lib/startKidMode'
import { isLocalParentSessionValid, writeLocalParentSession, LOCAL_PARENT_SESSION_MS } from '../lib/localParentAdmin'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY } from '../lib/safetubeSessionKeys'
import { supabase } from '../lib/supabase'
import { setAppModeKid } from '../lib/appMode'
import { useDeviceStore } from '../stores/deviceStore'
import { lockManagementAppShell } from '../lib/lockParentApp'
import { setParentEntryIntent } from '../lib/parentEntryIntent'
import { filterVideosByTitle } from '../lib/filterVideosByTitle'
import {
  buildYoutubeWatchUrl,
  isVideoShortOrSuspected,
  type WatchableVideoBase,
} from '../lib/videoFormatClassification'
import { classifyWatchFormat, filterSearchToWhitelistedChannels, isShortsBlockedForProfile } from '../lib/childContentSafety'
import { buildShortsAwareNavQueue } from '../lib/shortsNavQueue'
import { shouldHideFromChildBrowse } from '../lib/liveStreamPolicy'
import { policyFromDeviceFields, syncParentalControlPolicy } from '../lib/syncParentalControlPolicy'
import type { ChannelVideoItem } from '../lib/youtube'
import { searchYouTubeVideos, fetchChannelUploadsPage, fetchVideoDetailsBatch, resolveChannelUploadsCursor } from '../lib/youtube'
import type { YouTubeVideoResult } from '../types'
import { formatViewCountLabel } from '../lib/formatYoutubeCount'
import { formatRelativePublishedAt, joinVideoMetadataParts } from '../lib/formatRelativeTime'
import { listHiddenVideoIdsForChild } from '../lib/hiddenVideos'
import { ScreenTimeChildGate } from '../components/kid/ScreenTimeChildGate'
import { DailyWatchBudgetTracker } from '../components/kid/DailyWatchBudgetTracker'
import { LionProgressionProvider } from '../contexts/LionProgressionContext'
import { ChildRuntimeProvider, useChildRuntimeOptional } from '../contexts/ChildRuntimeContext'
import { LionProfileButton } from '../components/kid/LionProfileButton'
import { logPlaybackStreamRequest } from '../lib/streamApi'
import { SafeTubeBrandMark } from '../components/branding/SafeTubeBrandMark'
import { ThemeToggle } from '../components/theme/ThemeToggle'
import { PARENT_PIN_DIGIT_MAX } from '../lib/parentPin'

const KID_APP_DISPLAY_NAME = 'SafeTube Kids'
const PARENT_MODE_UNLOCK_MS = 10 * 60 * 1000
const PARENT_TAB_LONG_PRESS_MS = 650

function KidModePageInner() {
  const { t } = useTranslation()
  const childRuntime = useChildRuntimeOptional()
  const [bootLoading, setBootLoading] = useState(true)
  const [activatingDeviceId, setActivatingDeviceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<ChildDeviceState | null>(null)
  const [channels, setChannels] = useState<ChildAllowedChannel[]>([])
  const [channelVideos, setChannelVideos] = useState<ChannelVideoItem[]>([])
  const [channelLoading, setChannelLoading] = useState(false)
  const [channelLoadingMore, setChannelLoadingMore] = useState(false)
  /** Client-side uploads playlist cursor so every video remains reachable even if DB meta is stale. */
  const [uploadsCursor, setUploadsCursor] = useState<{
    nextPageToken: string | null
    uploadsPlaylistId: string | null
    hasMore: boolean
  } | null>(null)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [videoSearch, setVideoSearch] = useState('')
  const [globalSearchInput, setGlobalSearchInput] = useState('')
  const [kidSurface, setKidSurface] = useState<'watch' | 'parent'>('watch')
  const [kidWatchTab, setKidWatchTab] = useState<'channels' | 'playlist'>('channels')
  /** כל לחיצה על ערוץ (גם על אותו ערוץ) — כדי ש־useEffect יטען מחדש גם כש־activeChannelId לא משתנה */
  const [channelPickNonce, setChannelPickNonce] = useState(0)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [parentModeUnlocked, setParentModeUnlocked] = useState(false)
  const [parentModePinOpen, setParentModePinOpen] = useState(false)
  const [parentModePinInput, setParentModePinInput] = useState('')
  const [parentModePinError, setParentModePinError] = useState<string | null>(null)
  const [pendingParentAction, setPendingParentAction] = useState<'home' | 'channels' | null>(null)
  const [parentBootstrapBusy, setParentBootstrapBusy] = useState(false)
  const channelVideosRequestRef = useRef(0)
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const [videoSearchFocused, setVideoSearchFocused] = useState(false)
  const [globalSearchPinOpen, setGlobalSearchPinOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string | null>(null)
  const [globalSearchResults, setGlobalSearchResults] = useState<YouTubeVideoResult[]>([])
  const [globalSearchContinuation, setGlobalSearchContinuation] = useState<string | null>(null)
  const [globalSearchHasMore, setGlobalSearchHasMore] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchLoadingMore, setGlobalSearchLoadingMore] = useState(false)
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null)
  const pendingGlobalSearchQueryRef = useRef<string | null>(null)
  const videoMultiSelect = useVideoMultiSelect()
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false)
  const channelMultiSelect = useIdMultiSelect()
  const [channelBulkVideos, setChannelBulkVideos] = useState<PlaylistVideoPayload[]>([])
  const [channelBulkOpen, setChannelBulkOpen] = useState(false)
  const [channelBulkLoading, setChannelBulkLoading] = useState(false)
  const parentTabLongPressRef = useRef<number | null>(null)
  const parentSurfaceHintLongPressRef = useRef<number | null>(null)
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuth()
  const parentDevices = useDeviceStore((s) => s.devices)
  const fetchDevices = useDeviceStore((s) => s.fetchDevices)
  const parentDevicesLoading = useDeviceStore((s) => s.loading)

  useEffect(() => {
    lockManagementAppShell()
    setKidSurface('watch')
    setKidWatchTab('channels')
  }, [])

  const clearParentTabLongPress = useCallback(() => {
    if (parentTabLongPressRef.current != null) {
      window.clearTimeout(parentTabLongPressRef.current)
      parentTabLongPressRef.current = null
    }
  }, [])

  const clearParentSurfaceHintLongPress = useCallback(() => {
    if (parentSurfaceHintLongPressRef.current != null) {
      window.clearTimeout(parentSurfaceHintLongPressRef.current)
      parentSurfaceHintLongPressRef.current = null
    }
  }, [])

  const filteredVideos = useMemo(() => {
    const allowShorts = device?.allow_shorts ?? false
    const bySearch = filterVideosByTitle(channelVideos, videoSearch)
    const childSafe = bySearch.filter((video) => {
      if (shouldHideFromChildBrowse(video.title, video.liveBroadcastContent)) return false
      if (allowShorts) return true
      return !isVideoShortOrSuspected({
        title: video.title,
        durationSeconds: video.durationSeconds ?? null,
        watchUrl: buildYoutubeWatchUrl(video.videoId),
        youtubeVideoId: video.videoId,
        thumbnail_url: video.thumbnail || null,
      })
    })
    return childSafe
  }, [channelVideos, videoSearch, device?.allow_shorts])

  const browseVideos = useMemo((): WatchableVideoBase[] => {
    return filteredVideos.map((video) => ({
      youtube_video_id: video.videoId,
      title: video.title,
      thumbnail_url: video.thumbnail || null,
      durationSeconds: video.durationSeconds ?? null,
      watchUrl: buildYoutubeWatchUrl(video.videoId),
      format: classifyWatchFormat({
        durationSeconds: video.durationSeconds,
        youtubeVideoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail,
      }),
      viewCount: video.viewCount ?? null,
      likeCount: video.likeCount ?? null,
      publishedAt: video.publishedAt ?? null,
      liveBroadcastContent: video.liveBroadcastContent ?? 'none',
    }))
  }, [filteredVideos])

  const channelSearchDropdownItems = useMemo(
    () =>
      filteredVideos.map((video) => ({
        id: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail ?? null,
      })),
    [filteredVideos]
  )

  const verifyKidGlobalSearchPin = useCallback(
    async (pin: string) => {
      const token = accessToken ?? getSavedChildAccessToken()
      if (!token) {
        return { ok: false, errorMessage: 'המכשיר לא מחובר' } as const
      }
      const pinForServer = pin.replace(/\s+/g, '').trim()
      if (pinForServer.length < 4) {
        return { ok: false, errorMessage: 'קוד שגוי' } as const
      }
      const { data, error } = await supabase.rpc('local_parent_bootstrap', {
        p_access_token: token,
        p_pin: pinForServer,
      })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row?.device_id) {
        return { ok: false, errorMessage: 'קוד שגוי' } as const
      }
      writeLocalParentSession({
        deviceId: String(row.device_id),
        ownerUserId: String(row.owner_user_id),
        accessToken: token,
        pin: pinForServer,
      })
      return { ok: true as const }
    },
    [accessToken]
  )

  const clearGlobalSearch = useCallback(() => {
    pendingGlobalSearchQueryRef.current = null
    setGlobalSearchInput('')
    setGlobalSearchQuery(null)
    setGlobalSearchResults([])
    setGlobalSearchContinuation(null)
    setGlobalSearchHasMore(false)
    setGlobalSearchError(null)
    setGlobalSearchLoading(false)
    setGlobalSearchLoadingMore(false)
  }, [])

  const runGlobalYoutubeSearch = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return
    setGlobalSearchLoading(true)
    setGlobalSearchLoadingMore(false)
    setGlobalSearchError(null)
    setGlobalSearchQuery(q)
    setGlobalSearchResults([])
    setGlobalSearchContinuation(null)
    setGlobalSearchHasMore(false)
    const { data, error, continuation, hasMore } = await searchYouTubeVideos(q)
    setGlobalSearchLoading(false)
    if (error) {
      setGlobalSearchError(error.message)
      return
    }
    const allowedIds = channels.map((c) => c.youtube_channel_id)
    const safe = filterSearchToWhitelistedChannels(data ?? [], allowedIds)
    setGlobalSearchResults(safe)
    setGlobalSearchContinuation(continuation)
    setGlobalSearchHasMore(hasMore && safe.length > 0)
    if ((data?.length ?? 0) > 0 && safe.length === 0) {
      setGlobalSearchError('מוצגים רק סרטונים מערוצים מאושרים — לא נמצאו תוצאות מתאימות.')
    }
  }, [channels])

  const loadMoreGlobalYoutubeSearch = useCallback(async () => {
    const q = globalSearchQuery?.trim()
    if (!q || !globalSearchContinuation || globalSearchLoadingMore) return
    setGlobalSearchLoadingMore(true)
    setGlobalSearchError(null)
    const { data, error, continuation, hasMore } = await searchYouTubeVideos(q, {
      continuation: globalSearchContinuation,
    })
    setGlobalSearchLoadingMore(false)
    if (error) {
      setGlobalSearchError(error.message)
      return
    }
    const allowedIds = channels.map((c) => c.youtube_channel_id)
    const safe = filterSearchToWhitelistedChannels(data ?? [], allowedIds)
    setGlobalSearchResults((prev) => {
      const seen = new Set(prev.map((v) => v.videoId))
      const next = safe.filter((v) => !seen.has(v.videoId))
      return [...prev, ...next]
    })
    setGlobalSearchContinuation(continuation)
    setGlobalSearchHasMore(hasMore)
  }, [globalSearchQuery, globalSearchContinuation, globalSearchLoadingMore, channels])

  const handleGlobalSearchRequest = useCallback((query: string) => {
    const q = query.trim()
    if (!q) return
    setGlobalSearchInput(q)
    pendingGlobalSearchQueryRef.current = q
    setGlobalSearchPinOpen(true)
  }, [])

  const globalSearchSectionProps = useMemo(
    () => ({
      inputValue: globalSearchInput,
      onInputChange: setGlobalSearchInput,
      onSubmit: handleGlobalSearchRequest,
      query: globalSearchQuery,
      loading: globalSearchLoading,
      error: globalSearchError,
      results: globalSearchResults,
      hasMore: globalSearchHasMore,
      loadingMore: globalSearchLoadingMore,
      onLoadMore: loadMoreGlobalYoutubeSearch,
      onClear: clearGlobalSearch,
    }),
    [
      globalSearchInput,
      handleGlobalSearchRequest,
      globalSearchQuery,
      globalSearchLoading,
      globalSearchError,
      globalSearchResults,
      globalSearchHasMore,
      globalSearchLoadingMore,
      loadMoreGlobalYoutubeSearch,
      clearGlobalSearch,
    ]
  )

  const handleGlobalSearchPinVerified = useCallback(
    (_pin: string) => {
      const q = pendingGlobalSearchQueryRef.current
      pendingGlobalSearchQueryRef.current = null
      setGlobalSearchPinOpen(false)
      if (q) void runGlobalYoutubeSearch(q)
    },
    [runGlobalYoutubeSearch]
  )

  const handleGlobalSearchPinClose = useCallback(() => {
    pendingGlobalSearchQueryRef.current = null
    setGlobalSearchPinOpen(false)
  }, [])

  const activeVideo = useMemo(() => {
    if (!activeVideoId) return null
    return channelVideos.find((v) => v.videoId === activeVideoId) ?? null
  }, [channelVideos, activeVideoId])

  const activeChannel = useMemo(
    () => channels.find((c) => c.youtube_channel_id === (activeChannelId ?? '')) ?? null,
    [channels, activeChannelId]
  )

  const handleSelectVideo = useCallback(
    (videoId: string) => {
      if (childRuntime?.isBlocked) return
      const video = channelVideos.find((v) => v.videoId === videoId)
      if (!video) {
        toast.error('סרטון זה אינו מאושר לצפייה')
        return
      }
      if (
        isShortsBlockedForProfile(device?.allow_shorts, {
          title: video.title,
          durationSeconds: video.durationSeconds,
          youtubeVideoId: video.videoId,
          thumbnail_url: video.thumbnail || null,
        })
      ) {
        toast.error('Shorts חסומים בפרופיל זה')
        return
      }
      if (shouldHideFromChildBrowse(video.title, video.liveBroadcastContent)) {
        toast.error('תוכן זה אינו זמין לצפייה')
        return
      }
      logPlaybackStreamRequest(videoId, 'KidModePage.handleSelectVideo (play tap)')
      setActiveVideoId(videoId)
    },
    [childRuntime?.isBlocked, channelVideos, device?.allow_shorts]
  )

  const playerNavQueue = useMemo(() => {
    if (!activeVideo) return filteredVideos
    const asQueueItem = {
      videoId: activeVideo.videoId,
      youtube_video_id: activeVideo.videoId,
      title: activeVideo.title,
      channelTitle: activeVideo.channelTitle || '',
      durationSeconds: activeVideo.durationSeconds,
      thumbnail: activeVideo.thumbnail,
      format: classifyWatchFormat({
        durationSeconds: activeVideo.durationSeconds,
        youtubeVideoId: activeVideo.videoId,
        title: activeVideo.title,
        thumbnail: activeVideo.thumbnail,
      }),
    }
    return buildShortsAwareNavQueue(
      filteredVideos.map((v) => ({
        ...v,
        youtube_video_id: v.videoId,
        thumbnail: v.thumbnail,
        format: classifyWatchFormat({
          durationSeconds: v.durationSeconds,
          youtubeVideoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail,
        }),
      })),
      asQueueItem
    )
  }, [filteredVideos, activeVideo])

  const playerNavIndex = useMemo(() => {
    if (!activeVideoId) return -1
    return playerNavQueue.findIndex((v) => v.videoId === activeVideoId)
  }, [playerNavQueue, activeVideoId])

  const hasNextChannelVideo =
    playerNavIndex >= 0 && playerNavIndex < playerNavQueue.length - 1

  const handlePlayerNextTrack = useCallback(() => {
    const list = playerNavQueue
    const idx = list.findIndex((v) => v.videoId === activeVideoId)
    if (idx < 0 || idx >= list.length - 1) return
    handleSelectVideo(list[idx + 1]!.videoId)
  }, [playerNavQueue, activeVideoId, handleSelectVideo])

  const handlePlayerPreviousTrack = useCallback(() => {
    const list = playerNavQueue
    const idx = list.findIndex((v) => v.videoId === activeVideoId)
    if (idx <= 0) return
    handleSelectVideo(list[idx - 1]!.videoId)
  }, [playerNavQueue, activeVideoId, handleSelectVideo])

  useEffect(() => {
    if (!childRuntime?.playbackBlocked) return
    setActiveVideoId(null)
  }, [childRuntime?.playbackBlocked])

  const loadChannelVideos = useCallback(async (youtubeChannelId: string) => {
    const rid = ++channelVideosRequestRef.current
    const yt = youtubeChannelId
    if (!yt || !yt.trim()) {
      return
    }
    setChannelLoading(true)
    setError(null)
    if (!accessToken) {
      if (rid === channelVideosRequestRef.current) setChannelLoading(false)
      return
    }

    const fetchCached = async () => {
      const { data, error: cacheError } = await getChildCachedChannelVideos(accessToken, yt)
      if (cacheError) throw cacheError
      return (data ?? []).map(
        (v): ChannelVideoItem => ({
          videoId: v.youtube_video_id,
          title: v.title,
          thumbnail: v.thumbnail_url ?? '',
          channelTitle: '',
          durationSeconds: v.duration_seconds ?? null,
          publishedAt: v.published_at ?? null,
        })
      )
    }

    try {
      let next = await fetchCached()
      if (rid !== channelVideosRequestRef.current) return

      if (next.length === 0) {
        await new Promise((r) => setTimeout(r, 1200))
        if (rid !== channelVideosRequestRef.current) return
        next = await fetchCached()
      }

      if (rid !== channelVideosRequestRef.current) return

      if (next.length === 0) {
        const page = await fetchChannelUploadsPage(yt, { maxPages: 1 })
        if (rid !== channelVideosRequestRef.current) return
        if (page.error) {
          setError(page.error.message)
          setChannelLoading(false)
          return
        }
        const uploaded = (page.data?.videos ?? []).map((v) => ({
          videoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail || '',
          channelTitle: v.channelTitle || '',
          durationSeconds: v.durationSeconds ?? null,
          publishedAt: v.publishedAt ?? null,
        }))
        // Live uploads bypass SQL hidden-video filter — apply client-side red line.
        const { data: hiddenIds } = await listHiddenVideoIdsForChild(accessToken)
        next = uploaded.filter((v) => !hiddenIds.has(v.videoId))
      }

      if (rid !== channelVideosRequestRef.current) return
      setChannelVideos(next)
      setChannelLoading(false)

      void fetchVideoDetailsBatch(next.map((v) => v.videoId)).then((details) => {
        if (rid !== channelVideosRequestRef.current) return
        setChannelVideos((prev) =>
          prev.map((v) => {
            const d = details.get(v.videoId)
            if (!d) return v
            return {
              ...v,
              durationSeconds: v.durationSeconds ?? d.durationSeconds,
              viewCount: d.viewCount ?? v.viewCount,
              likeCount: d.likeCount ?? v.likeCount,
              publishedAt: v.publishedAt ?? d.publishedAt,
              liveBroadcastContent: d.liveBroadcastContent ?? v.liveBroadcastContent,
            }
          })
        )
      })

      // Resolve continuation so every older upload stays reachable via scroll / Load More.
      const chMeta = channelsRef.current.find((c) => c.youtube_channel_id === yt) ?? null
      void resolveChannelUploadsCursor({
        youtubeChannelId: yt,
        uploadsPlaylistId: chMeta?.videos_cache_uploads_playlist_id,
        knownVideoIds: next.map((v) => v.videoId),
        storedToken: chMeta?.videos_cache_next_page_token,
        storedHasMore: chMeta?.videos_cache_has_more,
      }).then((resolved) => {
        if (rid !== channelVideosRequestRef.current || resolved.error || !resolved.data) return
        const { newerVideos, boundaryOlderVideos, nextPageToken, hasMore, uploadsPlaylistId } =
          resolved.data

        if (newerVideos.length > 0 || boundaryOlderVideos.length > 0) {
          setChannelVideos((prev) => {
            const seen = new Set(prev.map((v) => v.videoId))
            const newer = newerVideos.filter((v) => !seen.has(v.videoId))
            for (const v of newer) seen.add(v.videoId)
            const older = boundaryOlderVideos.filter((v) => !seen.has(v.videoId))
            if (newer.length === 0 && older.length === 0) return prev
            return [...newer, ...prev, ...older]
          })
          const extras = [...newerVideos, ...boundaryOlderVideos]
          void fetchVideoDetailsBatch(extras.map((v) => v.videoId)).then((details) => {
            if (rid !== channelVideosRequestRef.current) return
            setChannelVideos((prev) =>
              prev.map((v) => {
                const d = details.get(v.videoId)
                if (!d) return v
                return {
                  ...v,
                  durationSeconds: v.durationSeconds ?? d.durationSeconds,
                  viewCount: d.viewCount ?? v.viewCount,
                  likeCount: d.likeCount ?? v.likeCount,
                  publishedAt: v.publishedAt ?? d.publishedAt,
                  liveBroadcastContent: d.liveBroadcastContent ?? v.liveBroadcastContent,
                }
              })
            )
          })
        }

        setUploadsCursor({
          nextPageToken,
          uploadsPlaylistId: uploadsPlaylistId || chMeta?.videos_cache_uploads_playlist_id || null,
          hasMore: Boolean(hasMore && nextPageToken),
        })
        setChannels((prev) =>
          prev.map((c) =>
            c.youtube_channel_id === yt
              ? {
                  ...c,
                  videos_cache_has_more: Boolean(hasMore && nextPageToken),
                  videos_cache_next_page_token: nextPageToken,
                  videos_cache_uploads_playlist_id:
                    uploadsPlaylistId || c.videos_cache_uploads_playlist_id,
                }
              : c
          )
        )
      })
    } catch (e) {
      if (rid !== channelVideosRequestRef.current) return
      setChannelLoading(false)
      setError(e instanceof Error ? e.message : 'טעינת סרטונים נכשלה')
    }
  }, [accessToken])

  const handleLoadOlderChannelVideos = useCallback(async () => {
    if (!activeChannelId || channelLoadingMore) return
    const token = uploadsCursor?.nextPageToken
    if (!token && !uploadsCursor?.hasMore) return

    setChannelLoadingMore(true)
    setError(null)
    try {
      const page = await fetchChannelUploadsPage(activeChannelId, {
        maxPages: 1,
        pageToken: token,
        uploadsPlaylistId: uploadsCursor?.uploadsPlaylistId,
      })
      if (page.error || !page.data) {
        setError(page.error?.message ?? 'טעינת סרטונים נוספים נכשלה')
        return
      }

      const incoming = page.data.videos
      setChannelVideos((prev) => {
        const seen = new Set(prev.map((v) => v.videoId))
        const extra = incoming.filter((v) => !seen.has(v.videoId))
        return [...prev, ...extra]
      })

      void fetchVideoDetailsBatch(incoming.map((v) => v.videoId)).then((details) => {
        setChannelVideos((prev) =>
          prev.map((v) => {
            const d = details.get(v.videoId)
            if (!d) return v
            return {
              ...v,
              durationSeconds: v.durationSeconds ?? d.durationSeconds,
              viewCount: d.viewCount ?? v.viewCount,
              likeCount: d.likeCount ?? v.likeCount,
              publishedAt: v.publishedAt ?? d.publishedAt,
              liveBroadcastContent: d.liveBroadcastContent ?? v.liveBroadcastContent,
            }
          })
        )
      })

      setUploadsCursor({
        nextPageToken: page.data.nextPageToken,
        uploadsPlaylistId: page.data.uploadsPlaylistId || uploadsCursor?.uploadsPlaylistId || null,
        hasMore: Boolean(page.data.hasMore && page.data.nextPageToken),
      })
      setChannels((prev) =>
        prev.map((c) =>
          c.youtube_channel_id === activeChannelId
            ? {
                ...c,
                videos_cache_has_more: Boolean(page.data!.hasMore && page.data!.nextPageToken),
                videos_cache_next_page_token: page.data!.nextPageToken,
                videos_cache_uploads_playlist_id:
                  page.data!.uploadsPlaylistId || c.videos_cache_uploads_playlist_id,
              }
            : c
        )
      )
    } finally {
      setChannelLoadingMore(false)
    }
  }, [activeChannelId, channelLoadingMore, uploadsCursor])

  const channelHasMoreVideos = Boolean(uploadsCursor?.hasMore)
  const handleBulkAddChannelsToPlaylist = useCallback(async () => {
    if (!accessToken) return
    const selected = channels.filter((c) => channelMultiSelect.selectedIds.has(c.youtube_channel_id))
    if (selected.length === 0) {
      toast.info('בחרו לפחות ערוץ אחד')
      return
    }
    setChannelBulkLoading(true)
    try {
      const { videos, error, skippedEmptyChannels } = await collectCachedVideosForChildChannels({
        accessToken,
        channels: selected.map((c) => ({
          youtube_channel_id: c.youtube_channel_id,
          channel_name: c.channel_name,
        })),
      })
      if (error) {
        toast.error('טעינת סרטונים נכשלה', { description: error.message })
        return
      }
      // Apply same kid-safe filters as browse (shorts / live) when possible.
      const allowShorts = device?.allow_shorts ?? false
      const safeVideos = videos.filter((v) => {
        if (shouldHideFromChildBrowse(v.title)) return false
        if (allowShorts) return true
        return !isVideoShortOrSuspected({
          title: v.title,
          durationSeconds: null,
          thumbnail_url: v.thumbnail_url,
          watchUrl: buildYoutubeWatchUrl(v.youtube_video_id),
          youtubeVideoId: v.youtube_video_id,
        })
      })
      if (safeVideos.length === 0) {
        toast.info('לא נמצאו סרטונים במטמון לערוצים שנבחרו')
        return
      }
      if (skippedEmptyChannels > 0) {
        toast.message(`${safeVideos.length} סרטונים נמצאו`, {
          description: `${skippedEmptyChannels} ערוצים ללא סרטונים במטמון דולגו`,
        })
      }
      setChannelBulkVideos(safeVideos)
      setChannelBulkOpen(true)
    } finally {
      setChannelBulkLoading(false)
    }
  }, [accessToken, channels, channelMultiSelect.selectedIds, device?.allow_shorts])

  const loadChildData = useCallback(async (token: string) => {
    const [stateRes, channelsRes] = await Promise.all([getChildDeviceState(token), getChildAllowedChannels(token)])
    if (stateRes.error) throw stateRes.error
    if (!stateRes.data) throw new Error('הפרופיל לא נמצא. בחרו פרופיל מחדש או פתחו את בקרת ההורים.')

    setDevice(stateRes.data)
    void syncParentalControlPolicy(policyFromDeviceFields(stateRes.data))
    if (channelsRes.error) {
      setChannels([])
      setError(channelsRes.error.message)
      return
    }

    setError(null)
    const list = channelsRes.data ?? []
    setChannels(list)
    // חשוב: לא לעשות trim כאן כדי לא לשבור התאמה מדויקת מול RPC.
    const availableIds = new Set(list.map((c) => c.youtube_channel_id))

    if (list.length === 0) {
      setActiveChannelId(null)
      setChannelVideos([])
      return
    }

    // אל תשתמשו ב-activeChannelId מהסגירה — בקשות polling ישנות יכולות לסיים אחרי בחירת ערוץ
    // ולדרוס את הבחירה; תמיד לעגנו ל־prev המעודכן מול הרשימה החדשה מהשרת.
    setActiveChannelId((prev) => {
      const p = prev ?? ''
      if (p && availableIds.has(p)) return p
      return list[0]?.youtube_channel_id ?? null
    })
  }, [])

  const loadChildDataRef = useRef(loadChildData)
  loadChildDataRef.current = loadChildData
  const bootOnceRef = useRef(false)

  useEffect(() => {
    if (bootOnceRef.current) return
    bootOnceRef.current = true

    const boot = async () => {
      const token = getSavedChildAccessToken()
      if (!token) {
        setBootLoading(false)
        return
      }
      try {
        setAccessToken(token)
        await loadChildDataRef.current(token)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (message.includes('הפרופיל לא נמצא') || message.includes('המכשיר לא נמצא')) {
          clearChildAccessToken()
          setAccessToken(null)
        }
        setError(e instanceof Error ? e.message : 'טעינת מצב ילד נכשלה')
      } finally {
        setBootLoading(false)
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    if (!isAuthenticated || accessToken || !user?.id) return
    void fetchDevices(user.id)
  }, [isAuthenticated, accessToken, user?.id, fetchDevices])


  useEffect(() => {
    if (!accessToken) return
    const channelsId = window.setInterval(() => {
      void loadChildData(accessToken).catch((e) => {
        setError(e instanceof Error ? e.message : 'עדכון ערוצים נכשל')
      })
    }, 15_000)
    return () => {
      window.clearInterval(channelsId)
    }
  }, [accessToken, loadChildData])

  useEffect(() => {
    const yt = activeChannelId
    if (!yt || !yt.trim()) {
      setChannelVideos([])
      return
    }
    // Clear previous channel's videos immediately so the UI doesn't show stale rows.
    setChannelVideos([])
    void loadChannelVideos(yt)
  }, [activeChannelId, channelPickNonce, loadChannelVideos])

  useEffect(() => {
    videoMultiSelect.exitSelectionMode()
    setBulkPlaylistOpen(false)
  }, [activeChannelId, channelPickNonce, videoMultiSelect.exitSelectionMode])

  useEffect(() => {
    if (channelVideos.length === 0) {
      setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) => {
      if (prev && channelVideos.some((v) => v.videoId === prev)) return prev
      return null
    })
  }, [channelVideos, activeChannelId, channelPickNonce])

  useEffect(() => {
    if (videoSearchFocused) return
    if (filteredVideos.length === 0) {
      if (videoSearch.trim()) setActiveVideoId(null)
      return
    }
    setActiveVideoId((prev) => {
      if (prev && filteredVideos.some((v) => v.videoId === prev)) return prev
      return null
    })
  }, [videoSearch, filteredVideos, videoSearchFocused])

  useEffect(() => {
    if (!accessToken) return
    const onBeforeUnload = () => {
      void childMarkOffline(accessToken)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [accessToken])

  const startWatchingProfile = useCallback(
    async (deviceId: string) => {
      setActivatingDeviceId(deviceId)
      setError(null)
      try {
        const { accessToken: token, error: startError } = await startKidModeForProfile(deviceId)
        if (startError || !token) throw startError ?? new Error('הפעלת מצב ילד נכשלה')
        setAppModeKid()
        setAccessToken(token)
        await loadChildData(token)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'הפעלת מצב ילד נכשלה')
      } finally {
        setActivatingDeviceId(null)
      }
    },
    [loadChildData]
  )

  // Single-device install: if parent is signed in and there is exactly one profile, start watching automatically.
  useEffect(() => {
    if (bootLoading || accessToken || !isAuthenticated || parentDevicesLoading) return
    if (activatingDeviceId || parentDevices.length !== 1) return
    void startWatchingProfile(parentDevices[0].id)
  }, [
    bootLoading,
    accessToken,
    isAuthenticated,
    parentDevicesLoading,
    parentDevices,
    activatingDeviceId,
    startWatchingProfile,
  ])

  const handleDisconnect = async () => {
    if (!accessToken) return
    setDisconnecting(true)
    try {
      await childMarkOffline(accessToken)
    } finally {
      clearChildAccessToken()
      setAccessToken(null)
      setDevice(null)
      setChannels([])
      setChannelVideos([])
      setActiveChannelId(null)
      setActiveVideoId(null)
      setPinInput('')
      setPinError(null)
      setPinModalOpen(false)
      lockParentMode()
      setParentModePinOpen(false)
      setParentModePinInput('')
      setParentModePinError(null)
      setPendingParentAction(null)
      setDisconnecting(false)
      setKidSurface('watch')
    }
  }

  const confirmPinAndDisconnect = async () => {
    const pinForServer = pinInput.replace(/\s+/g, '').trim()
    if (!accessToken) {
      setPinError('אין פרופיל פעיל. בחרו פרופיל מחדש.')
      return
    }
    if (pinForServer.length < 4) {
      setPinError('PIN שגוי')
      return
    }

    setPinError(null)
    const { data, error } = await supabase.rpc('local_parent_bootstrap', {
      p_access_token: accessToken,
      p_pin: pinForServer,
    })
    const row = Array.isArray(data) ? data[0] : null
    if (error || !row?.device_id) {
      setPinError('PIN שגוי')
      return
    }
    await handleDisconnect()
  }

  const runParentAction = (_action: 'home' | 'channels') => {
    setParentEntryIntent()
    const target = '/dashboard'
    if (isAuthenticated) {
      navigate(target)
      return
    }
    if (getSavedChildAccessToken() && isLocalParentSessionValid()) {
      navigate(target)
      return
    }
    navigate(`/auth?next=${encodeURIComponent(target)}`)
  }

  const lockParentMode = useCallback(() => {
    setParentModeUnlocked(false)
    setPendingParentAction(null)
    try {
      window.sessionStorage.removeItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const unlockParentMode = useCallback(() => {
    setParentModeUnlocked(true)
    const unlockUntil = Date.now() + PARENT_MODE_UNLOCK_MS
    try {
      window.sessionStorage.setItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY, String(unlockUntil))
    } catch {
      /* ignore */
    }
  }, [])

  const requestParentAction = async (action: 'home' | 'channels') => {
    if (isLocalParentSessionValid() && getSavedChildAccessToken()) {
      runParentAction(action)
      return
    }
    if (parentModeUnlocked) {
      runParentAction(action)
      return
    }
    setPendingParentAction(action)
    setParentModePinInput('')
    setParentModePinError(null)
    setParentModePinOpen(true)
  }

  const confirmParentModePin = async () => {
    const pinForServer = parentModePinInput.replace(/\s+/g, '').trim()
    const savedToken = getSavedChildAccessToken()
    if (pinForServer.length < 4) {
      setParentModePinError('PIN שגוי')
      return
    }
    if (!savedToken) {
      setParentModePinError('אין פרופיל פעיל. בחרו פרופיל מחדש.')
      return
    }

    setParentBootstrapBusy(true)
    try {
      const { data, error } = await supabase.rpc('local_parent_bootstrap', {
        p_access_token: savedToken,
        p_pin: pinForServer,
      })
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row?.device_id) {
        setParentModePinError('PIN שגוי')
        return
      }
      writeLocalParentSession({
        until: Date.now() + LOCAL_PARENT_SESSION_MS,
        deviceId: String(row.device_id),
        ownerUserId: String(row.owner_user_id),
        accessToken: savedToken,
        pin: pinForServer,
      })
    } finally {
      setParentBootstrapBusy(false)
    }

    unlockParentMode()
    setParentModePinOpen(false)
    setParentModePinInput('')
    setParentModePinError(null)
    const action = pendingParentAction
    setPendingParentAction(null)
    if (action) runParentAction(action)
  }

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      const unlockUntil = raw ? Number(raw) : 0
      if (unlockUntil > Date.now()) {
        setParentModeUnlocked(true)
      } else {
        window.sessionStorage.removeItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!parentModeUnlocked) return
    const raw = (() => {
      try {
        return window.sessionStorage.getItem(SAFETUBE_PARENT_MODE_UNLOCK_UNTIL_KEY)
      } catch {
        return null
      }
    })()
    const unlockUntil = raw ? Number(raw) : Date.now() + PARENT_MODE_UNLOCK_MS
    const remainingMs = Math.max(500, unlockUntil - Date.now())
    const timeoutId = window.setTimeout(() => {
      lockParentMode()
    }, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [parentModeUnlocked, lockParentMode])

  if (bootLoading) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <LoadingSpinner className="h-10 w-10 border-brand-500 border-t-transparent" />
        <p className="text-sm text-slate-600 dark:text-zinc-400">{t('kid.loading')}</p>
      </div>
    )
  }

  if (!accessToken || !device) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 pb-10 pt-8">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-zinc-50">{KID_APP_DISPLAY_NAME}</h1>
          <p className="mt-1 text-base font-semibold text-slate-800 dark:text-zinc-200">
            {t('kid.chooseWhoTitle')}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
            {t('kid.chooseWhoLead')}
          </p>
        </div>

        {isAuthenticated ? (
          <section className="rounded-2xl border-2 border-brand-400/40 bg-white p-5 shadow-sm ring-1 ring-brand-500/20 dark:border-brand-700/50 dark:bg-zinc-900">
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              {t('kid.whoIsWatching')}
            </p>
            {parentDevicesLoading && parentDevices.length === 0 ? (
              <div className="flex justify-center py-4">
                <LoadingSpinner className="h-8 w-8 border-brand-500 border-t-transparent" />
              </div>
            ) : parentDevices.length === 0 ? (
              <p className="text-center text-sm text-slate-600 dark:text-zinc-400">
                {t('kid.noProfilesYet')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {parentDevices.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50"
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-zinc-100">
                      {d.name}
                    </span>
                    <Button
                      type="button"
                      className="!h-9 shrink-0 !px-3 !text-xs font-bold"
                      disabled={activatingDeviceId !== null}
                      onClick={() => void startWatchingProfile(d.id)}
                    >
                      {activatingDeviceId === d.id ? (
                        <LoadingSpinner className="h-4 w-4 border-2 border-white border-t-transparent" />
                      ) : null}
                      {activatingDeviceId === d.id ? t('kid.starting') : t('kid.startWatching')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {error ? <p className="mt-3 text-sm text-danger-600">{error}</p> : null}
          </section>
        ) : (
          <section className="rounded-2xl border-2 border-brand-400/40 bg-white p-5 shadow-sm ring-1 ring-brand-500/20 dark:border-brand-700/50 dark:bg-zinc-900">
            <p className="mb-3 text-center text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
              {t('kid.signInToSetup')}
            </p>
            <Button
              type="button"
              className="w-full text-base font-bold"
              onClick={() => void requestParentAction('home')}
            >
              {t('kid.parentLogin')}
            </Button>
            {error ? <p className="mt-3 text-sm text-danger-600">{error}</p> : null}
          </section>
        )}

        {isAuthenticated ? (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void requestParentAction('home')}>
            {t('kid.parentDashboard')}
          </Button>
        ) : null}
      </main>
    )
  }

  return (
    <ScreenTimeChildGate>
    <LionProgressionProvider>
    <DailyWatchBudgetTracker deviceId={device?.device_id ?? null} />
    <div className="min-h-dvh bg-gradient-to-b from-sky-50 via-white to-violet-50 text-yt-text dark:from-slate-950 dark:via-yt-bg dark:to-indigo-950/40">
      <header className="sticky top-0 z-30 border-b border-sky-200/70 bg-gradient-to-r from-sky-100/95 via-indigo-50/95 to-violet-100/95 backdrop-blur-md dark:border-indigo-900/50 dark:from-indigo-950/90 dark:via-sky-950/80 dark:to-violet-950/90">
        <div className="mx-auto grid max-w-[1920px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 px-2 py-2 sm:gap-x-4 sm:px-3 sm:py-2">
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-bold text-yt-text">
              {kidSurface === 'parent'
                ? 'אזור הורים'
                : kidWatchTab === 'playlist'
                  ? 'הפלייליסטים שלי'
                  : device.device_name}
            </p>
            <p className="text-[11px] text-yt-textMuted">{KID_APP_DISPLAY_NAME}</p>
          </div>
          <SafeTubeBrandMark to="/kid" className="justify-self-center px-0.5" />
          <div className="flex min-w-0 items-center justify-end gap-2 ps-2 pe-0.5 sm:gap-3 sm:pe-1">
            {kidSurface === 'watch' ? <LionProfileButton /> : null}
            <div
              className="flex shrink-0 items-center gap-0.5 rounded-full border border-yt-border bg-yt-input p-0.5"
              role="tablist"
              aria-label="מצב מסך"
            >
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'watch' && kidWatchTab === 'channels'}
              onClick={() => {
                setKidSurface('watch')
                setKidWatchTab('channels')
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                kidSurface === 'watch' && kidWatchTab === 'channels'
                  ? 'bg-sky-500 text-white shadow-sm dark:bg-sky-600'
                  : 'text-yt-textMuted hover:text-yt-text'
              }`}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              צפייה
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'watch' && kidWatchTab === 'playlist'}
              onClick={() => {
                setKidSurface('watch')
                setKidWatchTab('playlist')
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold transition sm:px-3 ${
                kidSurface === 'watch' && kidWatchTab === 'playlist'
                  ? 'bg-violet-500 text-white shadow-sm dark:bg-violet-600'
                  : 'text-yt-textMuted hover:text-yt-text'
              }`}
            >
              <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
              פלייליסטים
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kidSurface === 'parent'}
              aria-label="הורים — לחיצה ארוכה לפתיחה"
              title={`החזיקו לחוץ כדי לפתוח (${PARENT_TAB_LONG_PRESS_MS / 1000} שנ׳)`}
              onPointerDown={() => {
                clearParentTabLongPress()
                parentTabLongPressRef.current = window.setTimeout(() => {
                  parentTabLongPressRef.current = null
                  setKidSurface('parent')
                }, PARENT_TAB_LONG_PRESS_MS)
              }}
              onPointerUp={clearParentTabLongPress}
              onPointerLeave={clearParentTabLongPress}
              onPointerCancel={clearParentTabLongPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => e.preventDefault()}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition touch-manipulation select-none ${
                kidSurface === 'parent'
                  ? 'bg-yt-surfaceHover text-yt-text shadow-sm'
                  : 'text-yt-textMuted opacity-90 hover:text-yt-text'
              }`}
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              הורים
            </button>
            </div>
            <ThemeToggle compact className="shrink-0" />
          </div>
        </div>
      </header>

      {kidSurface === 'watch' && kidWatchTab === 'channels' && channels.length > 0 ? (
        <div className="border-b border-yt-border bg-yt-bg px-2 py-2 xs:px-3 md:hidden">
          <KidGlobalSearchSection
            id="kid-global-youtube-search-mobile"
            compact
            {...globalSearchSectionProps}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mx-auto max-w-[1920px] px-3 py-2 text-sm text-danger-600 sm:px-4">{error}</p>
      ) : null}

      {kidSurface === 'parent' ? (
        <main className="mx-auto w-full max-w-lg space-y-4 px-2 py-3 sm:px-3">
          <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90">
            <h2 className="text-sm font-bold text-slate-800 dark:text-zinc-100">ניהול הורה במכשיר הזה</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
              אם כבר התחברתם כהורה באותו דפדפן — עוברים ללוח בלי להקליד שוב אימייל. מצב הילד נשמר במכשיר עד
              יציאה מפורשת עם PIN.
            </p>
            <p className="mt-2 text-[11px] text-slate-500 dark:text-zinc-500">
              {parentModeUnlocked ? 'מצב הורה (PIN) נפתח ל־10 דקות.' : 'מעבר ללוח/ערוצים דורש PIN הורה או סשן שכבר אומת.'}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                type="button"
                variant="secondary"
                className="w-full min-[400px]:w-auto"
                onClick={() => void requestParentAction('home')}
              >
                {isAuthenticated
                  ? 'לוח בקרה'
                  : isLocalParentSessionValid() && getSavedChildAccessToken()
                    ? 'לוח בקרה'
                    : 'התחברות — לוח בקרה'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full min-[400px]:w-auto"
                onClick={() => void requestParentAction('channels')}
              >
                {isAuthenticated
                  ? 'ניהול ערוצים'
                  : isLocalParentSessionValid() && getSavedChildAccessToken()
                    ? 'ניהול ערוצים'
                    : 'התחברות — ערוצים'}
              </Button>
              {parentModeUnlocked ? (
                <Button type="button" variant="secondary" onClick={lockParentMode} className="w-full min-[400px]:w-auto">
                  נעל מצב הורה
                </Button>
              ) : null}
            </div>
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-zinc-800">
              <p className="text-xs text-slate-600 dark:text-zinc-400">יציאה ממצב ילד — בחירת פרופיל מחדש (נדרש PIN)</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-2 w-full border-danger-200 text-danger-700 hover:bg-danger-50 dark:border-danger-800 dark:text-danger-300 dark:hover:bg-danger-950/40 sm:w-auto"
                onClick={() => setPinModalOpen(true)}
              >
                יציאה ממצב ילד
              </Button>
            </div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">
              לחזרה ללוח ההורה: החזיקו לחוץ על לשונית &quot;הורים&quot; למעלה והזינו PIN.
            </p>
          </section>
        </main>
      ) : (childRuntime?.isBlocked ?? device.is_blocked) ? (
        <section className="mx-auto max-w-lg px-4 py-10">
          <div className="rounded-2xl border border-danger-700/50 bg-gradient-to-b from-danger-900/30 to-danger-950/80 p-8 text-center text-danger-100 shadow-inner">
            <ShieldAlert className="mx-auto mb-3 h-12 w-12 opacity-90" aria-hidden />
            <h2 className="text-xl font-black tracking-tight">{KID_APP_DISPLAY_NAME}</h2>
            <p className="mt-3 text-sm leading-relaxed opacity-95">
              הצפייה חסומה כרגע מההורה. בקשו לפתוח — או עברו ללשונית <strong>הורים</strong> לנהל או לצאת ממצב ילד.
            </p>
          </div>
        </section>
      ) : (
        <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-0 md:grid md:min-h-0 md:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] md:items-start">
          {kidWatchTab === 'playlist' ? (
            <div className="min-w-0 flex-1 md:col-span-2">
              {accessToken ? (
                <KidPlaylistView
                  childAccessToken={accessToken}
                  allowShorts={Boolean(device?.allow_shorts)}
                  hideThumbnails={Boolean(device?.hide_thumbnails)}
                />
              ) : null}
            </div>
          ) : channels.length === 0 ? (
            <div className="px-2 py-3 xs:px-3 sm:px-4 md:col-span-2">
              <div className="rounded-2xl border border-amber-200/90 bg-amber-50/95 px-4 py-5 text-sm leading-relaxed text-amber-950 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-100">
                <p className="font-semibold">אין ערוצים מאושרים לפרופיל הזה</p>
                <p className="mt-2 text-amber-900/95 dark:text-amber-200/90">
                  בלשונית <strong className="font-bold">הורים</strong> — ניהול ערוצים, ובחרו את הפרופיל &quot;{device.device_name}
                  &quot;.
                </p>
                <p className="mt-2 text-[11px] text-amber-900/90 dark:text-amber-200/85">
                  לפתיחת אזור ההורים: החזיקו לחוץ על כפתור &quot;הורים&quot; בשורת הכותרת למעלה.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  title={`החזיקו לחוץ (${PARENT_TAB_LONG_PRESS_MS / 1000} שנ׳)`}
                  onPointerDown={() => {
                    clearParentSurfaceHintLongPress()
                    parentSurfaceHintLongPressRef.current = window.setTimeout(() => {
                      parentSurfaceHintLongPressRef.current = null
                      setKidSurface('parent')
                    }, PARENT_TAB_LONG_PRESS_MS)
                  }}
                  onPointerUp={clearParentSurfaceHintLongPress}
                  onPointerLeave={clearParentSurfaceHintLongPress}
                  onPointerCancel={clearParentSurfaceHintLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={(e) => e.preventDefault()}
                >
                  לשונית הורים (לחיצה ארוכה)
                </Button>
              </div>
            </div>
          ) : (
            <>
              <aside className="hidden min-h-0 border-s border-yt-border bg-yt-surface md:sticky md:top-[52px] md:block md:max-h-[calc(100dvh-3rem)] md:shrink-0 md:overflow-y-auto md:pb-6">
                <div className="border-b border-yt-border p-2">
                  <KidGlobalSearchSection
                    id="kid-global-youtube-search-desktop"
                    compact
                    {...globalSearchSectionProps}
                  />
                </div>
                <p className="border-b border-yt-border bg-yt-surface/80 px-3 py-2.5 text-xs font-bold text-yt-textMuted backdrop-blur">
                  הערוצים שלי
                  {channelBulkLoading ? (
                    <span className="ms-2 font-medium text-yt-textMuted">טוען…</span>
                  ) : null}
                </p>
                {accessToken ? (
                  <div className="border-b border-yt-border px-2 py-2">
                    <PlaylistMultiSelectToolbar
                      compact
                      selectionMode={channelMultiSelect.selectionMode}
                      selectedCount={channelMultiSelect.selectedCount}
                      totalVisible={channels.length}
                      itemNoun="ערוצים"
                      enterLabel="בחירת ערוצים"
                      addButtonLabel="הוסף לפלייליסט"
                      onEnterSelectionMode={channelMultiSelect.enterSelectionMode}
                      onExitSelectionMode={channelMultiSelect.exitSelectionMode}
                      onSelectAllVisible={() =>
                        channelMultiSelect.selectMany(channels.map((c) => c.youtube_channel_id))
                      }
                      onClearSelection={channelMultiSelect.clear}
                      onAddToPlaylist={() => void handleBulkAddChannelsToPlaylist()}
                    />
                  </div>
                ) : null}
                <div className="flex flex-col gap-0.5 p-2">
                  {channels.map((channel) => {
                    const yt = channel.youtube_channel_id
                    const selected = yt === (activeChannelId ?? '')
                    const checked = channelMultiSelect.isSelected(yt)
                    return (
                      <button
                        key={channel.channel_id}
                        type="button"
                        onClick={() => {
                          if (channelMultiSelect.selectionMode) {
                            channelMultiSelect.toggle(yt)
                            return
                          }
                          setVideoSearch('')
                          clearGlobalSearch()
                          setActiveChannelId(yt)
                          setChannelPickNonce((n) => n + 1)
                        }}
                        className={`flex w-full items-center gap-2 rounded-xl p-2 text-right transition ${
                          channelMultiSelect.selectionMode && checked
                            ? 'bg-brand-500/15 ring-1 ring-brand-500/40'
                            : selected
                              ? 'bg-slate-200/80 dark:bg-zinc-800'
                              : 'hover:bg-slate-100 dark:hover:bg-zinc-800/80'
                        }`}
                      >
                        {channelMultiSelect.selectionMode ? (
                          <PlaylistSelectCheckbox
                            checked={checked}
                            onChange={() => channelMultiSelect.toggle(yt)}
                            className="!h-9 !w-9"
                          />
                        ) : null}
                        {channel.channel_thumbnail ? (
                          <img
                            src={channel.channel_thumbnail}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 dark:bg-zinc-800">
                            <Smartphone className="h-4 w-4" />
                          </div>
                        )}
                        <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug text-slate-800 dark:text-zinc-200">
                          {channel.channel_name}
                        </span>
                        {channel.category ? (
                          <span className="shrink-0 text-[10px] text-brand-600 dark:text-brand-400">{channel.category}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </aside>

              <div className="min-w-0 flex-1 bg-gradient-to-b from-sky-50/80 via-white to-violet-50/60 dark:from-slate-950 dark:via-[#0f0f0f] dark:to-indigo-950/20 md:pt-0">
                <div className="border-b border-black/[0.06] bg-white px-1.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-950/90 md:hidden">
                  <div className="mb-1.5 flex flex-col gap-1.5 px-0.5">
                    <p className="text-[11px] font-bold text-slate-500">ערוץ</p>
                    {accessToken ? (
                      <PlaylistMultiSelectToolbar
                        compact
                        selectionMode={channelMultiSelect.selectionMode}
                        selectedCount={channelMultiSelect.selectedCount}
                        totalVisible={channels.length}
                        itemNoun="ערוצים"
                        enterLabel="בחירת ערוצים"
                        addButtonLabel="הוסף לפלייליסט"
                        onEnterSelectionMode={channelMultiSelect.enterSelectionMode}
                        onExitSelectionMode={channelMultiSelect.exitSelectionMode}
                        onSelectAllVisible={() =>
                          channelMultiSelect.selectMany(channels.map((c) => c.youtube_channel_id))
                        }
                        onClearSelection={channelMultiSelect.clear}
                        onAddToPlaylist={() => void handleBulkAddChannelsToPlaylist()}
                      />
                    ) : null}
                  </div>
                  <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5 pt-0.5">
                    {channels.map((channel) => {
                      const yt = channel.youtube_channel_id
                      const selected = yt === (activeChannelId ?? '')
                      const checked = channelMultiSelect.isSelected(yt)
                      return (
                        <button
                          key={channel.channel_id}
                          type="button"
                          onClick={() => {
                            if (channelMultiSelect.selectionMode) {
                              channelMultiSelect.toggle(yt)
                              return
                            }
                            setVideoSearch('')
                            clearGlobalSearch()
                            setActiveChannelId(yt)
                            setChannelPickNonce((n) => n + 1)
                          }}
                          className={`flex shrink-0 flex-col items-center gap-1 rounded-2xl px-2 py-1.5 ${
                            channelMultiSelect.selectionMode && checked
                              ? 'bg-brand-500/20 ring-1 ring-brand-500/50'
                              : selected
                                ? 'bg-slate-200 dark:bg-zinc-800'
                                : 'bg-slate-100/80 dark:bg-zinc-900/80'
                          }`}
                        >
                          {channelMultiSelect.selectionMode ? (
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold ${
                                checked
                                  ? 'border-brand-600 bg-brand-600 text-white'
                                  : 'border-slate-400 text-transparent'
                              }`}
                              aria-hidden
                            >
                              ✓
                            </span>
                          ) : null}
                          {channel.channel_thumbnail ? (
                            <img
                              src={channel.channel_thumbnail}
                              alt=""
                              className="h-12 w-12 rounded-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 dark:bg-zinc-800">
                              <Smartphone className="h-5 w-5 text-slate-500" />
                            </div>
                          )}
                          <span className="line-clamp-1 max-w-[4.5rem] text-center text-[10px] font-medium text-slate-800 dark:text-zinc-200">
                            {channel.channel_name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="border-b border-zinc-800/80 bg-[#0f0f0f] px-2 py-2 xs:px-3 xs:py-3 md:hidden">
                  <ChannelVideoSearchBar
                    id="kid-channel-video-search-mobile"
                    value={videoSearch}
                    onChange={setVideoSearch}
                    onFocusChange={setVideoSearchFocused}
                    totalCount={channelVideos.length}
                    filteredCount={filteredVideos.length}
                    channelLabel={activeChannel?.channel_name ?? null}
                    dropdownResults={channelSearchDropdownItems}
                    activeResultId={activeVideoId}
                    onSelectResult={handleSelectVideo}
                    dropdownLoading={channelLoading}
                  />
                </div>

                <YoutubeWatchLayout
                  className="mx-auto max-w-[1600px] px-1 pb-3 pt-1.5 xs:px-1.5 sm:px-2 sm:pb-4 md:px-3 md:pt-2"
                  main={
                    channelLoading ? (
                      <div className="flex aspect-video max-w-5xl items-center justify-center gap-3 rounded-xl bg-black/90 text-zinc-200">
                        <LoadingSpinner className="h-9 w-9 shrink-0 border-2 border-red-500 border-t-transparent" />
                        <span className="text-base font-semibold">טוען…</span>
                      </div>
                    ) : activeVideo ? (
                      <>
                        <ChildWatchPlayerShell
                          videoId={activeVideo.videoId}
                          title={activeVideo.title}
                          channelTitle={activeChannel?.channel_name}
                          posterUrl={device?.hide_thumbnails ? null : activeVideo.thumbnail}
                          blankVideoFrame={Boolean(device?.hide_thumbnails)}
                          format={classifyWatchFormat({
                            durationSeconds: activeVideo.durationSeconds,
                            youtubeVideoId: activeVideo.videoId,
                            title: activeVideo.title,
                            thumbnail: activeVideo.thumbnail,
                          })}
                          onNextTrack={handlePlayerNextTrack}
                          onPreviousTrack={handlePlayerPreviousTrack}
                          hasNextTrack={hasNextChannelVideo}
                        />
                        <YoutubeWatchVideoDetails
                          title={activeVideo.title}
                          channelName={activeChannel?.channel_name ?? null}
                          channelThumbnail={activeChannel?.channel_thumbnail ?? null}
                          subtitle={
                            joinVideoMetadataParts(
                              formatViewCountLabel(activeVideo.viewCount),
                              formatRelativePublishedAt(activeVideo.publishedAt)
                            ) || 'מאושר — SafeTube'
                          }
                          actions={
                            <>
                              <YoutubeLikeButton
                                videoId={activeVideo.videoId}
                                likeCount={activeVideo.likeCount}
                              />
                              {accessToken ? (
                                <AddToPlaylistButton
                                  mode="kid"
                                  userId={null}
                                  childAccessToken={accessToken}
                                  video={{
                                    youtube_video_id: activeVideo.videoId,
                                    title: activeVideo.title,
                                    thumbnail_url: activeVideo.thumbnail || null,
                                    youtube_channel_id: activeChannelId,
                                    channel_name: activeChannel?.channel_name ?? null,
                                  }}
                                />
                              ) : null}
                            </>
                          }
                        />
                      </>
                    ) : channelVideos.length > 0 && videoSearch.trim() ? (
                      <div className="flex min-h-[min(50vh,320px)] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-gradient-to-b from-white to-slate-50/90 px-5 py-10 text-center dark:border-brand-900/50 dark:from-zinc-900/80 dark:to-zinc-950/90">
                        <Search
                          className="h-16 w-16 text-brand-500 dark:text-brand-400"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <p className="max-w-sm text-xl font-bold leading-tight text-slate-800 dark:text-zinc-100">
                          לא מצאנו סרטון עם המילים האלה
                        </p>
                        <p className="max-w-md text-base leading-relaxed text-slate-600 dark:text-zinc-400">
                          נסו שם אחר, או מחקו את החיפוש כדי לראות את כל הסרטונים בערוץ.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-[48px] min-w-[160px] rounded-2xl text-base font-semibold"
                          onClick={() => {
                            setVideoSearch('')
                            clearGlobalSearch()
                          }}
                        >
                          מחק חיפוש
                        </Button>
                      </div>
                    ) : (
                      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white/50 px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
                        <Unplug className="h-14 w-14 text-slate-400" strokeWidth={1.75} aria-hidden />
                        <p className="text-base font-medium text-slate-700 dark:text-zinc-300">בחרו ערוץ כדי לטעון סרטונים.</p>
                      </div>
                    )
                  }
                  sidebar={
                    <>
                      <ChannelVideoSearchBar
                        id="kid-channel-video-search"
                        value={videoSearch}
                        onChange={setVideoSearch}
                        onFocusChange={setVideoSearchFocused}
                        totalCount={channelVideos.length}
                        filteredCount={filteredVideos.length}
                        channelLabel={activeChannel?.channel_name ?? null}
                        className="mb-3 hidden md:block"
                        dropdownResults={channelSearchDropdownItems}
                        activeResultId={activeVideoId}
                        onSelectResult={handleSelectVideo}
                        dropdownLoading={channelLoading}
                      />

                      {accessToken ? (
                        <PlaylistMultiSelectToolbar
                          className="mb-3"
                          compact
                          selectionMode={videoMultiSelect.selectionMode}
                          selectedCount={videoMultiSelect.selectedCount}
                          totalVisible={filteredVideos.length}
                          onEnterSelectionMode={videoMultiSelect.enterSelectionMode}
                          onExitSelectionMode={videoMultiSelect.exitSelectionMode}
                          onClearSelection={videoMultiSelect.clear}
                          onSelectAllVisible={() =>
                            videoMultiSelect.selectMany(
                              filteredVideos.map(
                                (video): PlaylistVideoPayload => ({
                                  youtube_video_id: video.videoId,
                                  title: video.title,
                                  thumbnail_url: video.thumbnail || null,
                                  youtube_channel_id: activeChannelId,
                                  channel_name: activeChannel?.channel_name ?? null,
                                })
                              )
                            )
                          }
                          onAddToPlaylist={() => setBulkPlaylistOpen(true)}
                        />
                      ) : null}

                      <ChannelVideoBrowseRows
                        videos={browseVideos}
                        activeVideoId={activeVideoId}
                        allowShorts={Boolean(device?.allow_shorts)}
                        hideThumbnails={Boolean(device?.hide_thumbnails)}
                        hasMore={!videoSearch.trim() && channelHasMoreVideos}
                        loadingMore={channelLoadingMore}
                        onLoadMore={() => void handleLoadOlderChannelVideos()}
                        loadMoreLabel={t('channels.loadOlderVideos')}
                        loadingMoreLabel={t('channels.loadingOlderVideos')}
                        onSelectVideo={(video) => {
                          const payload: PlaylistVideoPayload = {
                            youtube_video_id: video.youtube_video_id,
                            title: video.title,
                            thumbnail_url: video.thumbnail_url,
                            youtube_channel_id: activeChannelId,
                            channel_name: activeChannel?.channel_name ?? null,
                          }
                          if (videoMultiSelect.selectionMode) {
                            videoMultiSelect.toggle(payload)
                            return
                          }
                          handleSelectVideo(video.youtube_video_id)
                        }}
                        renderAction={(video) =>
                          accessToken ? (
                            videoMultiSelect.selectionMode ? (
                              <PlaylistSelectCheckbox
                                checked={videoMultiSelect.isSelected(video.youtube_video_id)}
                                onChange={() =>
                                  videoMultiSelect.toggle({
                                    youtube_video_id: video.youtube_video_id,
                                    title: video.title,
                                    thumbnail_url: video.thumbnail_url,
                                    youtube_channel_id: activeChannelId,
                                    channel_name: activeChannel?.channel_name ?? null,
                                  })
                                }
                              />
                            ) : (
                              <AddToPlaylistButton
                                mode="kid"
                                userId={null}
                                childAccessToken={accessToken}
                                compact
                                video={{
                                  youtube_video_id: video.youtube_video_id,
                                  title: video.title,
                                  thumbnail_url: video.thumbnail_url,
                                  youtube_channel_id: activeChannelId,
                                  channel_name: activeChannel?.channel_name ?? null,
                                }}
                              />
                            )
                          ) : null
                        }
                      />
                      {!channelLoading && filteredVideos.length === 0 ? (
                        <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300/90 bg-white/40 px-3 py-6 text-center dark:border-zinc-600 dark:bg-zinc-900/40">
                          <p className="text-sm font-semibold leading-snug text-slate-700 dark:text-zinc-300">
                            {videoSearch.trim()
                              ? 'אין סרטונים שמתאימים לחיפוש.'
                              : channelVideos.length === 0
                                ? 'אין עדיין סרטונים בערוץ הזה. בקשו מההורה להוסיף סרטונים.'
                                : 'אין סרטונים.'}
                          </p>
                        </div>
                      ) : null}
                    </>
                  }
                />
              </div>
            </>
          )}
        </div>
      )}

      <Modal
        open={parentModePinOpen}
        onClose={() => {
          setParentModePinOpen(false)
          setParentModePinInput('')
          setParentModePinError(null)
          setPendingParentAction(null)
        }}
        title="פתיחת מצב הורה"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setParentModePinOpen(false)
                setParentModePinInput('')
                setParentModePinError(null)
                setPendingParentAction(null)
              }}
            >
              ביטול
            </Button>
            <Button onClick={() => void confirmParentModePin()} disabled={parentBootstrapBusy}>
              {parentBootstrapBusy ? 'מאמת…' : 'אשר'}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600 dark:text-zinc-400">
          הכניסה לניהול הורה מהמכשיר הזה מוגנת ב-PIN.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={parentModePinInput}
          onChange={(e) => {
            setParentModePinInput(e.target.value)
            if (parentModePinError) setParentModePinError(null)
          }}
          placeholder="PIN הורה"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && !parentBootstrapBusy && void confirmParentModePin()}
        />
        {parentModePinError ? <p className="mt-2 text-sm text-danger-600">{parentModePinError}</p> : null}
      </Modal>

      <Modal
        open={pinModalOpen}
        onClose={() => {
          if (disconnecting) return
          setPinModalOpen(false)
          setPinInput('')
          setPinError(null)
        }}
        title="אישור הורה"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPinModalOpen(false)
                setPinInput('')
                setPinError(null)
              }}
              disabled={disconnecting}
            >
              ביטול
            </Button>
            <Button onClick={() => void confirmPinAndDisconnect()} disabled={disconnecting}>
              {disconnecting ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
              {disconnecting ? 'יוצא...' : 'אשר ויציאה'}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600 dark:text-zinc-400">
          הזינו את קוד ההורה ({PARENT_PIN_DIGIT_MAX} ספרות) שמוגדר אצל ההורה באפליקציה.
        </p>
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value)
            if (pinError) setPinError(null)
          }}
          placeholder={`למשל: ${'1'.repeat(PARENT_PIN_DIGIT_MAX)}`}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void confirmPinAndDisconnect()}
        />
        {pinError ? <p className="mt-2 text-sm text-danger-600">{pinError}</p> : null}
      </Modal>

      <ParentalPinModal
        open={globalSearchPinOpen}
        onClose={handleGlobalSearchPinClose}
        verifyPin={verifyKidGlobalSearchPin}
        onVerified={handleGlobalSearchPinVerified}
        title="אימות הורה — חיפוש YouTube"
        description="חיפוש בכל YouTube דורש קוד הורה. הזינו PIN כדי להמשיך — אחרת החיפוש יבוטל."
      />

      {accessToken ? (
        <AddToPlaylistModal
          open={bulkPlaylistOpen}
          onClose={() => setBulkPlaylistOpen(false)}
          mode="kid"
          userId={null}
          childAccessToken={accessToken}
          videos={videoMultiSelect.selectedVideos}
          onSuccess={() => {
            videoMultiSelect.exitSelectionMode()
            setBulkPlaylistOpen(false)
          }}
        />
      ) : null}

      {accessToken ? (
        <AddToPlaylistModal
          open={channelBulkOpen}
          onClose={() => {
            setChannelBulkOpen(false)
            setChannelBulkVideos([])
          }}
          mode="kid"
          userId={null}
          childAccessToken={accessToken}
          videos={channelBulkVideos}
          onSuccess={() => {
            channelMultiSelect.exitSelectionMode()
            setChannelBulkOpen(false)
            setChannelBulkVideos([])
          }}
        />
      ) : null}
    </div>
    </LionProgressionProvider>
    </ScreenTimeChildGate>
  )
}

export function KidModePage() {
  return (
    <ChildRuntimeProvider>
      <KidModePageInner />
    </ChildRuntimeProvider>
  )
}
