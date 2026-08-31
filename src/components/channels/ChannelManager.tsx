import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import { useChannelStore } from '../../stores/channelStore'
import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
import { supabase } from '../../lib/supabase'
import { WhitelistView } from './WhitelistView'
import { TopicDiscoveryModal } from './TopicDiscoveryModal'
import { RemoveChannelModal } from './RemoveChannelModal'
import { CleanPlayer } from '../player/CleanPlayer'
import { Button } from '../ui/Button'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { isProfileParentPinMissing } from '../../lib/parentPin'
import {
  getParentPinSession,
  isParentManagementSessionVerified,
  setParentPinSession,
} from '../../lib/parentPinSession'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '../ui/Skeleton'
import { Modal } from '../ui/Modal'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import { AddToPlaylistModal } from '../playlists/AddToPlaylistModal'
import {
  PlaylistMultiSelectToolbar,
  PlaylistSelectCheckbox,
} from '../playlists/PlaylistMultiSelectToolbar'
import { useVideoMultiSelect } from '../../hooks/useVideoMultiSelect'
import { useIdMultiSelect } from '../../hooks/useIdMultiSelect'
import type { PlaylistVideoPayload } from '../../lib/playlists'
import { collectCachedVideosForParentChannels } from '../../lib/collectCachedChannelVideos'
import { QuickBlockButton } from './QuickBlockButton'
import { useHideVideoContext } from '../../hooks/useHideVideoContext'
import { ChannelManagerVideoSearch } from './ChannelManagerVideoSearch'
import { CHANNEL_MANAGER_SEARCH_CONTROL_CLASS, CHANNEL_MANAGER_SEARCH_SHELL_CLASS } from './channelManagerSearchStyles'
import { cn } from '../../lib/utils'
import { ChannelVideoSearchBar } from '../kid/ChannelVideoSearchBar'
import { YoutubeWatchLayout } from '../youtube/YoutubeWatchLayout'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeWatchVideoDetails } from '../youtube/YoutubeWatchVideoDetails'
import { YoutubeLikeButton } from '../youtube/YoutubeLikeButton'
import { YoutubeSuggestedList } from '../youtube/YoutubeSuggestedList'
import { filterVideosByTitle } from '../../lib/filterVideosByTitle'
import { listHiddenVideoIdsForDevice, listHiddenVideoIdsLocalParent } from '../../lib/hiddenVideos'
import { ChannelAddedSuccessModal } from './ChannelAddedSuccessModal'
import { fetchVideoDetailsBatch } from '../../lib/youtube'
import { formatVideoDurationClock } from '../../lib/formatRelativeTime'
import { CONTENT_TAGS_ENABLED } from '../../config/contentTags'
import { TagOnAddPrompt } from '../contentTags/TagOnAddPrompt'
import { ChannelTagBulkToolbar } from '../contentTags/ChannelTagBulkToolbar'
import { useContentTagStore } from '../../stores/contentTagStore'

type PreviewRow = {
  videoId: string
  title: string
  thumbnail: string | null
  durationSeconds?: number | null
}

type PendingPinAction =
  | { kind: 'openSearch' }
  | { kind: 'openVideoSearch' }
  | { kind: 'add'; channel: YouTubeChannelResult }
  | { kind: 'addMany'; channels: YouTubeChannelResult[] }
  | { kind: 'remove'; channel: WhitelistedChannel }
  | { kind: 'removeMany'; channels: WhitelistedChannel[] }

type ChannelManagerProps = {
  managedDeviceId?: string | null
  embedded?: boolean
}

export function ChannelManager({ managedDeviceId = null, embedded = false }: ChannelManagerProps) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const hideVideoCtx = useHideVideoContext()
  const localParentPinForRpcRef = useRef<string | null>(null)
  const getLocalParentPin = useCallback(() => localParentPinForRpcRef.current, [])
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [addedSearchChannelIds, setAddedSearchChannelIds] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [bulkRemoveTargets, setBulkRemoveTargets] = useState<WhitelistedChannel[] | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [addSuccessModalOpen, setAddSuccessModalOpen] = useState(false)
  const [lastAddedChannelId, setLastAddedChannelId] = useState<string | null>(null)
  const [lastAddedChannelName, setLastAddedChannelName] = useState<string | null>(null)
  const [addSuccessCount, setAddSuccessCount] = useState(1)
  const [addSuccessTagIds, setAddSuccessTagIds] = useState<Set<string>>(new Set())
  const [addSuccessTagSaving, setAddSuccessTagSaving] = useState(false)
  const [bulkTagIds, setBulkTagIds] = useState<Set<string>>(new Set())
  const [bulkTagApplying, setBulkTagApplying] = useState(false)
  const [previewChannel, setPreviewChannel] = useState<WhitelistedChannel | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewVideos, setPreviewVideos] = useState<PreviewRow[]>([])
  const [activePreviewVideoId, setActivePreviewVideoId] = useState<string | null>(null)
  const [previewVideoSearch, setPreviewVideoSearch] = useState('')
  const [hiddenVideoIds, setHiddenVideoIds] = useState<Set<string>>(new Set())
  const videoMultiSelect = useVideoMultiSelect()
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false)
  const channelMultiSelect = useIdMultiSelect()
  const [channelBulkVideos, setChannelBulkVideos] = useState<PlaylistVideoPayload[]>([])
  const [channelBulkOpen, setChannelBulkOpen] = useState(false)
  const [channelBulkLoading, setChannelBulkLoading] = useState(false)
  const [previewRefreshing, setPreviewRefreshing] = useState(false)
  const [previewLoadingMore, setPreviewLoadingMore] = useState(false)
  const [previewReloadToken, setPreviewReloadToken] = useState(0)
  const [videoSearchOpenSignal, setVideoSearchOpenSignal] = useState(0)
  const previewAutoRefreshTriedRef = useRef<string | null>(null)
  const preferredPreviewVideoIdRef = useRef<string | null>(null)
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const requestedDeviceId = managedDeviceId ?? searchParams.get('device')

  const playlistMode = user?.id ? 'parent' : 'kid'
  const playlistUserId = user?.id ? (ownerUserId ?? user.id) : null
  const playlistChildToken = user?.id ? null : localParent.localAccessToken
  const canUsePlaylists = Boolean(user?.id || localParent.localAccessToken)
  const tagCatalog = useContentTagStore((s) => s.catalog)
  const fetchTagCatalog = useContentTagStore((s) => s.fetchCatalog)
  const fetchDeviceTagPrefs = useContentTagStore((s) => s.fetchDevicePrefs)
  const setChannelTags = useContentTagStore((s) => s.setChannelTags)
  const bulkSetChannelTags = useContentTagStore((s) => s.bulkSetChannelTags)
  const canBulkTag = CONTENT_TAGS_ENABLED && Boolean(deviceId)

  useEffect(() => {
    if (!CONTENT_TAGS_ENABLED || !deviceId) return
    void fetchTagCatalog()
    void fetchDeviceTagPrefs(deviceId)
  }, [deviceId, fetchTagCatalog, fetchDeviceTagPrefs])

  const toggleAddSuccessTag = useCallback((tagId: string) => {
    setAddSuccessTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const toggleBulkTag = useCallback((tagId: string) => {
    setBulkTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const saveAddSuccessTags = useCallback(async () => {
    if (!deviceId || !lastAddedChannelId || addSuccessTagIds.size === 0) return true
    setAddSuccessTagSaving(true)
    const { error } = await setChannelTags(deviceId, lastAddedChannelId, [...addSuccessTagIds])
    setAddSuccessTagSaving(false)
    if (error) {
      toast.error(t('contentTags.saveFailed'), { description: error.message })
      return false
    }
    return true
  }, [addSuccessTagIds, deviceId, lastAddedChannelId, setChannelTags, t])

  const closeAddSuccessModal = useCallback(
    async (next: 'more' | 'done') => {
      if (addSuccessTagIds.size > 0) {
        const ok = await saveAddSuccessTags()
        if (!ok) return
      }
      setAddSuccessModalOpen(false)
      setLastAddedChannelId(null)
      setLastAddedChannelName(null)
      setAddSuccessCount(1)
      setAddSuccessTagIds(new Set())
      if (next === 'more') {
        setSearchOpen(true)
        return
      }
      setSearchOpen(false)
    },
    [addSuccessTagIds.size, saveAddSuccessTags]
  )

  const handleBulkApplyTags = useCallback(async () => {
    if (!deviceId) return
    const channelIds = [...channelMultiSelect.selectedIds]
    if (channelIds.length === 0) {
      toast.message(t('channels.selectAtLeastOne'))
      return
    }
    if (bulkTagIds.size === 0) {
      toast.message(t('contentTags.pickTagsFirst'))
      return
    }
    const { error } = await bulkSetChannelTags(deviceId, channelIds, [...bulkTagIds])
    setBulkTagApplying(false)
    if (error) {
      toast.error(t('contentTags.saveFailed'), { description: error.message })
      return
    }
    toast.success(t('contentTags.bulkTagDone', { count: channelIds.length }))
    setBulkTagIds(new Set())
    channelMultiSelect.exitSelectionMode()
  }, [bulkSetChannelTags, bulkTagIds, channelMultiSelect, deviceId, t])

  const toPreviewPlaylistPayload = useCallback(
    (v: PreviewRow): PlaylistVideoPayload => ({
      youtube_video_id: v.videoId,
      title: v.title,
      thumbnail_url: v.thumbnail,
      youtube_channel_id: previewChannel?.youtube_channel_id ?? null,
      channel_name: previewChannel?.channel_name ?? null,
    }),
    [previewChannel]
  )

  const pendingPinActionRef = useRef<PendingPinAction | null>(null)
  const staleRefreshStartedRef = useRef(false)

  const {
    whitelist,
    loading: listLoading,
    addToWhitelist,
    removeFromWhitelist,
    refreshChannelVideosCache,
    appendChannelVideosCache,
  } = useChannels(deviceId ?? undefined, user?.id ?? ownerUserId, {
    localAccessToken: localParent.isActive ? localParent.localAccessToken : null,
    getLocalParentPin: localParent.isActive ? getLocalParentPin : undefined,
  })

  const whitelistedChannelIds = useMemo(
    () => new Set(whitelist.map((c) => c.youtube_channel_id).filter(Boolean)),
    [whitelist]
  )

  // Backfill stale caches after the list is on screen so opening channels stays snappy.
  useEffect(() => {
    if (listLoading || whitelist.length === 0 || staleRefreshStartedRef.current) return
    const stale = whitelist
      .filter((c) => {
        const last = c.last_videos_refresh_at ? new Date(c.last_videos_refresh_at).getTime() : 0
        return last === 0 || Date.now() - last > 24 * 60 * 60 * 1000
      })
      .slice(0, 4)
    if (stale.length === 0) return
    const timer = window.setTimeout(() => {
      staleRefreshStartedRef.current = true
      for (const ch of stale) {
        void refreshChannelVideosCache(ch.id, ch.youtube_channel_id, false)
      }
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [listLoading, whitelist, refreshChannelVideosCache])

  useEffect(() => {
    staleRefreshStartedRef.current = false
  }, [deviceId])

  const handleBulkAddChannelsToPlaylist = useCallback(async () => {
    const selected = whitelist.filter((c) => channelMultiSelect.selectedIds.has(c.id))
    if (selected.length === 0) {
      toast.info(t('channels.selectAtLeastOne'))
      return
    }
    setChannelBulkLoading(true)
    try {
      const collect = () =>
        collectCachedVideosForParentChannels({
          channels: selected,
          deviceId,
          localAccessToken: localParent.isActive ? localParent.localAccessToken : null,
          localPin: localParent.isActive ? (getLocalParentPin?.() ?? localParent.pin ?? '') : null,
        })

      let { videos, error, skippedEmptyChannels } = await collect()
      if (error) {
        toast.error(t('channels.loadVideosFailed'), { description: error.message })
        return
      }

      // Cache may still be empty if a prior refresh failed — force YouTube refresh once, then retry.
      if (videos.length === 0) {
        toast.message(t('channels.refreshingCache'))
        const refreshed = await Promise.all(
          selected.map((ch) => refreshChannelVideosCache(ch.id, ch.youtube_channel_id, true))
        )
        const firstError = refreshed.find((r) => r.error)?.error
        if (firstError) {
          toast.error(t('channels.loadVideosFailed'), { description: firstError.message })
          return
        }
        ;({ videos, error, skippedEmptyChannels } = await collect())
        if (error) {
          toast.error(t('channels.loadVideosFailed'), { description: error.message })
          return
        }
      }

      if (videos.length === 0) {
        toast.info(t('channels.noCachedVideos'))
        return
      }
      if (skippedEmptyChannels > 0) {
        toast.message(t('channels.videosFound', { count: videos.length }), {
          description: t('channels.skippedEmpty', { count: skippedEmptyChannels }),
        })
      }
      setChannelBulkVideos(videos)
      setChannelBulkOpen(true)
    } finally {
      setChannelBulkLoading(false)
    }
  }, [
    t,
    whitelist,
    channelMultiSelect.selectedIds,
    deviceId,
    localParent.isActive,
    localParent.localAccessToken,
    localParent.pin,
    getLocalParentPin,
    refreshChannelVideosCache,
  ])

  useEffect(() => {
    channelMultiSelect.exitSelectionMode()
    setChannelBulkOpen(false)
    setChannelBulkVideos([])
  }, [deviceId, channelMultiSelect.exitSelectionMode])

  useEffect(() => {
    if (devices.length === 0) return
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      if (deviceId !== requestedDeviceId) setDeviceId(requestedDeviceId)
      return
    }
    if (!deviceId || !devices.some((d) => d.id === deviceId)) {
      setDeviceId(devices[0].id)
    }
  }, [devices, deviceId, requestedDeviceId])

  const handleDeviceChange = useCallback(
    (nextDeviceId: string) => {
      setDeviceId(nextDeviceId)
      if (!embedded) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('device', nextDeviceId)
            return next
          },
          { replace: true }
        )
      }
    },
    [embedded, setSearchParams]
  )

  useEffect(() => {
    if (localParent.isActive) {
      localParentPinForRpcRef.current = localParent.pin ?? ''
      return
    }
    const sessionPin = getParentPinSession()
    if (sessionPin) localParentPinForRpcRef.current = sessionPin
  }, [localParent.isActive, localParent.pin])

  const handleAdd = async (
    c: YouTubeChannelResult,
    opts?: { showSuccessModal?: boolean; toastSuccess?: boolean }
  ): Promise<boolean> => {
    if (!localParent.isActive && !selectedDevice) {
      toast.error(t('channels.noDeviceSelected'))
      return false
    }
    const showSuccessModal = opts?.showSuccessModal ?? true
    const toastSuccess = opts?.toastSuccess ?? !showSuccessModal
    // Instant UI: mark added immediately; spinner must not override the checkmark.
    setAddedSearchChannelIds((prev) => new Set(prev).add(c.channelId))
    setAddingId(null)
    if (toastSuccess && !showSuccessModal) {
      toast.success(t('channels.channelAddedTitle'), { description: c.title })
    }
    try {
      const { error, cacheError: _cacheError } = await addToWhitelist(c, null)
      if (error) {
        console.error('[ChannelManager] addToWhitelist failed', error.message, c.channelId)
        setAddedSearchChannelIds((prev) => {
          const next = new Set(prev)
          next.delete(c.channelId)
          return next
        })
        toast.error(error.message)
        return false
      }
      if (showSuccessModal) {
        const ch = useChannelStore.getState().whitelist.find((row) => row.youtube_channel_id === c.channelId)
        setLastAddedChannelId(ch?.id ?? null)
        setLastAddedChannelName(c.title)
        setAddSuccessCount(1)
        setAddSuccessTagIds(new Set())
        setSearchOpen(false)
        setAddSuccessModalOpen(true)
      }
      return true
    } catch (e) {
      console.error('[ChannelManager] handleAdd unexpected error', e)
      setAddedSearchChannelIds((prev) => {
        const next = new Set(prev)
        next.delete(c.channelId)
        return next
      })
      toast.error(e instanceof Error ? e.message : t('errors.generic'))
      return false
    }
  }

  const handleAddMany = async (channels: YouTubeChannelResult[]) => {
    const unique: YouTubeChannelResult[] = []
    const seen = new Set<string>()
    for (const c of channels) {
      if (!c.channelId || seen.has(c.channelId)) continue
      if (addedSearchChannelIds.has(c.channelId) || whitelistedChannelIds.has(c.channelId)) continue
      seen.add(c.channelId)
      unique.push(c)
    }
    if (unique.length === 0) return
    let ok = 0
    let lastName: string | null = null
    const batchSize = 4
    for (let i = 0; i < unique.length; i += batchSize) {
      const slice = unique.slice(i, i + batchSize)
      const results = await Promise.all(
        slice.map((c) => handleAdd(c, { showSuccessModal: false, toastSuccess: false }))
      )
      for (let j = 0; j < results.length; j++) {
        if (results[j]) {
          ok += 1
          lastName = slice[j]?.title ?? lastName
        }
      }
    }
    if (ok > 0) {
      setLastAddedChannelName(ok === 1 ? lastName : null)
      setAddSuccessCount(ok)
      setLastAddedChannelId(null)
      setAddSuccessTagIds(new Set())
      setSearchOpen(false)
      setAddSuccessModalOpen(true)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoveLoading(true)
    const removedYoutubeId = removeTarget.youtube_channel_id
    const removedId = removeTarget.id
    const { error } = await removeFromWhitelist(removedId)
    setRemoveLoading(false)
    if (error) toast.error(error.message)
    else {
      toast.success(t('channels.removed'))
      setRemoveTarget(null)
      setAddedSearchChannelIds((prev) => {
        if (!removedYoutubeId || !prev.has(removedYoutubeId)) return prev
        const next = new Set(prev)
        next.delete(removedYoutubeId)
        return next
      })
      if (previewChannel?.id === removedId) setPreviewChannel(null)
    }
  }

  const requestRemoveByYoutubeChannelId = (youtubeChannelId: string) => {
    const channel =
      whitelist.find((c) => c.youtube_channel_id === youtubeChannelId) ?? null
    if (!channel) {
      toast.error(t('channels.alreadyGone'))
      return
    }
    requestRemoveChannel(channel)
  }

  const runPendingAction = (pending: PendingPinAction) => {
    if (pending.kind === 'openSearch') {
      setSearchOpen(true)
      return
    }
    if (pending.kind === 'openVideoSearch') {
      setVideoSearchOpenSignal((n) => n + 1)
      return
    }
    if (pending.kind === 'add') {
      void handleAdd(pending.channel)
      return
    }
    if (pending.kind === 'addMany') {
      void handleAddMany(pending.channels)
      return
    }
    if (pending.kind === 'removeMany') {
      setRemoveTarget(null)
      setBulkRemoveTargets(pending.channels)
      return
    }
    setBulkRemoveTargets(null)
    setRemoveTarget(pending.channel)
  }

  const beginPinGate = (action: PendingPinAction) => {
    // Onboarding defers PIN setup — a signed-in parent may have no PIN yet. There is
    // nothing to verify in that state, so the PIN modal would dead-end (no code can match).
    if (user?.id && profile && isProfileParentPinMissing(profile)) {
      runPendingAction(action)
      return
    }
    pendingPinActionRef.current = action
    setPinModalOpen(true)
  }

  const verifyChannelParentPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        { userId: user?.id, profile, localParent: { isActive: localParent.isActive, pin: localParent.pin } },
        pin
      ),
    [user?.id, profile, localParent]
  )

  const runAfterVerifiedPin = (trimmedPin: string) => {
    localParentPinForRpcRef.current = trimmedPin
    setParentPinSession(trimmedPin)
    const pending = pendingPinActionRef.current
    pendingPinActionRef.current = null
    setPinModalOpen(false)

    if (!pending) return
    runPendingAction(pending)
  }

  const requestOpenChannelSearch = () => {
    if (isParentManagementSessionVerified()) {
      setSearchOpen(true)
      return
    }
    beginPinGate({ kind: 'openSearch' })
  }

  const requestOpenVideoSearch = () => {
    if (isParentManagementSessionVerified()) {
      setVideoSearchOpenSignal((n) => n + 1)
      return
    }
    beginPinGate({ kind: 'openVideoSearch' })
  }

  const requestAddChannel = (c: YouTubeChannelResult) => {
    if (isParentManagementSessionVerified()) {
      void handleAdd(c, { showSuccessModal: true, toastSuccess: false })
      return
    }
    beginPinGate({ kind: 'add', channel: c })
  }

  const requestAddChannels = (channels: YouTubeChannelResult[]) => {
    if (channels.length === 0) return
    if (channels.length === 1) {
      requestAddChannel(channels[0]!)
      return
    }
    if (isParentManagementSessionVerified()) {
      void handleAddMany(channels)
      return
    }
    beginPinGate({ kind: 'addMany', channels })
  }

  const requestRemoveChannel = (c: WhitelistedChannel) => {
    if (isParentManagementSessionVerified()) {
      setBulkRemoveTargets(null)
      setRemoveTarget(c)
      return
    }
    beginPinGate({ kind: 'remove', channel: c })
  }

  const requestBulkRemoveChannels = (channels: WhitelistedChannel[]) => {
    if (channels.length === 0) return
    if (channels.length === 1) {
      requestRemoveChannel(channels[0]!)
      return
    }
    if (isParentManagementSessionVerified()) {
      setRemoveTarget(null)
      setBulkRemoveTargets(channels)
      return
    }
    beginPinGate({ kind: 'removeMany', channels })
  }

  const confirmBulkRemove = async () => {
    if (!bulkRemoveTargets?.length) return
    setRemoveLoading(true)
    let ok = 0
    const youtubeIds: string[] = []
    for (const channel of bulkRemoveTargets) {
      const { error } = await removeFromWhitelist(channel.id)
      if (!error) {
        ok += 1
        if (channel.youtube_channel_id) youtubeIds.push(channel.youtube_channel_id)
      }
    }
    setRemoveLoading(false)
    if (ok === 0) {
      toast.error(t('channels.removeFailed'))
      return
    }
    toast.success(ok === 1 ? t('channels.removed') : t('channels.removedCount', { count: ok }))
    setBulkRemoveTargets(null)
    setAddedSearchChannelIds((prev) => {
      if (youtubeIds.length === 0) return prev
      const next = new Set(prev)
      for (const id of youtubeIds) next.delete(id)
      return next
    })
    if (previewChannel && bulkRemoveTargets.some((c) => c.id === previewChannel.id)) {
      setPreviewChannel(null)
    }
    channelMultiSelect.exitSelectionMode()
  }

  useEffect(() => {
    const channel = previewChannel
    if (!channel) {
      setPreviewLoading(false)
      setPreviewError(null)
      setPreviewVideos([])
      setActivePreviewVideoId(null)
      setPreviewVideoSearch('')
      setHiddenVideoIds(new Set())
      setPreviewRefreshing(false)
      previewAutoRefreshTriedRef.current = null
      videoMultiSelect.exitSelectionMode()
      setBulkPlaylistOpen(false)
      return
    }

    let cancelled = false
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewVideos([])
    setActivePreviewVideoId(null)
    setPreviewVideoSearch('')

    void (async () => {
      try {
        let rows: PreviewRow[] = []
        let hidden = new Set<string>()

        const loadRows = async () => {
          if (localParent.isActive && localParent.localAccessToken) {
            const pin = getLocalParentPin?.() ?? ''
            const { data, error } = await supabase.rpc('local_parent_list_channel_videos', {
              p_access_token: localParent.localAccessToken,
              p_pin: pin,
              p_youtube_channel_id: channel.youtube_channel_id,
            })
            if (error) throw new Error(error.message)
            rows = ((data ?? []) as Record<string, unknown>[]).map((v) => {
              const row = v as {
                youtube_video_id: string
                title: string
                thumbnail_url: string | null
                duration_seconds?: number | null
              }
              return {
                videoId: row.youtube_video_id,
                title: row.title,
                thumbnail: row.thumbnail_url,
                durationSeconds: row.duration_seconds ?? null,
              }
            })
            const hidRes = await listHiddenVideoIdsLocalParent(localParent.localAccessToken, pin)
            hidden = hidRes.data
          } else if (user) {
            const { data, error } = await supabase
              .from('channel_videos_cache')
              .select('youtube_video_id, title, thumbnail_url, duration_seconds, position')
              .eq('channel_id', channel.id)
              .order('position', { ascending: true })
            if (error) throw new Error(error.message)
            rows = (data ?? []).map((r) => {
              const row = r as {
                youtube_video_id: string
                title: string
                thumbnail_url: string | null
                duration_seconds?: number | null
              }
              return {
                videoId: row.youtube_video_id,
                title: row.title,
                thumbnail: row.thumbnail_url,
                durationSeconds: row.duration_seconds ?? null,
              }
            })
            if (deviceId) {
              const hidRes = await listHiddenVideoIdsForDevice(deviceId)
              hidden = hidRes.data
            }
          } else {
            throw new Error(t('channels.noLocalPermission'))
          }
        }

        await loadRows()

        // Auto-refresh once from YouTube when cache is empty for this channel.
        if (
          rows.length === 0 &&
          previewAutoRefreshTriedRef.current !== channel.id &&
          !cancelled
        ) {
          previewAutoRefreshTriedRef.current = channel.id
          setPreviewRefreshing(true)
          const refreshed = await refreshChannelVideosCache(channel.id, channel.youtube_channel_id, true)
          if (refreshed.error) {
            if (!cancelled) setPreviewError(refreshed.error.message)
          } else if (!cancelled) {
            await loadRows()
          }
          if (!cancelled) setPreviewRefreshing(false)
        }

        if (cancelled) return
        setPreviewVideos(rows)
        setHiddenVideoIds(hidden)
        const visible = rows.filter((r) => !hidden.has(r.videoId))
        const preferred = preferredPreviewVideoIdRef.current
        preferredPreviewVideoIdRef.current = null
        const preferredVisible = preferred && visible.some((r) => r.videoId === preferred) ? preferred : null
        setActivePreviewVideoId(preferredVisible ?? visible[0]?.videoId ?? null)

        const missingDurationIds = rows
          .filter((r) => r.durationSeconds == null || r.durationSeconds <= 0)
          .map((r) => r.videoId)
        if (missingDurationIds.length > 0) {
          void fetchVideoDetailsBatch(missingDurationIds).then((details) => {
            if (cancelled) return
            setPreviewVideos((prev) => {
              let changed = false
              const next = prev.map((v) => {
                const d = details.get(v.videoId)
                if (!d?.durationSeconds || (v.durationSeconds != null && v.durationSeconds > 0)) return v
                changed = true
                return { ...v, durationSeconds: d.durationSeconds }
              })
              return changed ? next : prev
            })
          })
        }
      } catch (e) {
        if (cancelled) return
        setPreviewError(e instanceof Error ? e.message : t('channels.loadVideosFailed'))
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
          setPreviewRefreshing(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    previewChannel,
    previewReloadToken,
    localParent.isActive,
    localParent.localAccessToken,
    user,
    deviceId,
    getLocalParentPin,
    refreshChannelVideosCache,
    t,
  ])

  const handleRefreshPreviewFromYouTube = useCallback(async () => {
    if (!previewChannel || previewRefreshing) return
    setPreviewRefreshing(true)
    setPreviewError(null)
    const refreshed = await refreshChannelVideosCache(
      previewChannel.id,
      previewChannel.youtube_channel_id,
      true
    )
    setPreviewRefreshing(false)
    if (refreshed.error) {
      toast.error(t('channels.loadVideosFailed'), { description: refreshed.error.message })
      return
    }
    previewAutoRefreshTriedRef.current = null
    setPreviewReloadToken((n) => n + 1)
    toast.success(t('channels.cacheRefreshed'))
  }, [previewChannel, previewRefreshing, refreshChannelVideosCache, t])

  const handleLoadMorePreviewVideos = useCallback(async () => {
    if (!previewChannel || previewLoadingMore || previewRefreshing) return
    const meta =
      whitelist.find((c) => c.id === previewChannel.id) ?? previewChannel
    if (!meta.videos_cache_has_more) return
    setPreviewLoadingMore(true)
    setPreviewError(null)
    const appended = await appendChannelVideosCache(
      previewChannel.id,
      previewChannel.youtube_channel_id
    )
    setPreviewLoadingMore(false)
    if (appended.error) {
      toast.error(t('channels.loadVideosFailed'), { description: appended.error.message })
      return
    }
    setPreviewReloadToken((n) => n + 1)
  }, [
    previewChannel,
    previewLoadingMore,
    previewRefreshing,
    whitelist,
    appendChannelVideosCache,
    t,
  ])

  const filteredPreviewVideos = useMemo(
    () => filterVideosByTitle(previewVideos, previewVideoSearch),
    [previewVideos, previewVideoSearch]
  )

  const baseVisiblePreviewCount = useMemo(
    () => previewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)).length,
    [previewVideos, hiddenVideoIds]
  )

  /** Visible to parent in channel preview; hidden videos are omitted from this playback list. */
  const visiblePreviewVideos = useMemo(
    () => filteredPreviewVideos.filter((v) => !hiddenVideoIds.has(v.videoId)),
    [filteredPreviewVideos, hiddenVideoIds]
  )

  const activePreviewVideo = useMemo(() => {
    if (!activePreviewVideoId) return null
    const video = previewVideos.find((v) => v.videoId === activePreviewVideoId)
    if (!video || hiddenVideoIds.has(video.videoId)) return null
    return video
  }, [previewVideos, activePreviewVideoId, hiddenVideoIds])

  const goPrevManagerPreview = useCallback(() => {
    if (!activePreviewVideoId) return
    const idx = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
    if (idx > 0) setActivePreviewVideoId(visiblePreviewVideos[idx - 1].videoId)
  }, [visiblePreviewVideos, activePreviewVideoId])

  const goNextManagerPreview = useCallback(() => {
    if (!activePreviewVideoId) return
    const idx = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
    if (idx >= 0 && idx < visiblePreviewVideos.length - 1) {
      setActivePreviewVideoId(visiblePreviewVideos[idx + 1].videoId)
    }
  }, [visiblePreviewVideos, activePreviewVideoId])

  const previewActiveIndex = visiblePreviewVideos.findIndex((v) => v.videoId === activePreviewVideoId)
  const hasNextPreviewVideo =
    previewActiveIndex >= 0 && previewActiveIndex < visiblePreviewVideos.length - 1

  const handleHidden = useCallback(
    (videoId: string) => {
      setHiddenVideoIds((prev) => {
        const next = new Set(prev).add(videoId)
        setActivePreviewVideoId((current) => {
          if (current !== videoId) return current
          const remaining = previewVideos.filter((v) => v.videoId !== videoId && !prev.has(v.videoId))
          const searched = filterVideosByTitle(remaining, previewVideoSearch)
          return searched[0]?.videoId ?? null
        })
        return next
      })
    },
    [previewVideos, previewVideoSearch]
  )

  const handlePickPreviewVideo = useCallback((videoId: string) => {
    setActivePreviewVideoId(videoId)
  }, [])

  const embeddedEmptyChannels =
    embedded && whitelist.length === 0 && !listLoading && !devLoading && devices.length > 0
  const compactAddButtons = embeddedEmptyChannels

  return (
    <div
      className={cn(
        embedded ? 'flex w-full flex-col gap-2' : 'mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3',
        embeddedEmptyChannels && 'py-2'
      )}
    >
      <header className={cn('flex flex-col gap-2', compactAddButtons && 'w-full')}>
        {!embedded ? (
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ניהול ערוצים</h1>
        ) : null}
        {!embedded && devices.length > 1 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">בחירת פרופיל</span>
            <select
              className="min-h-12 appearance-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-zinc-800 focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20"
              style={{ colorScheme: 'dark' }}
              value={deviceId ?? ''}
              onChange={(e) => handleDeviceChange(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id} className="bg-zinc-950 text-zinc-100">
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div
          className={cn(
            'flex flex-col gap-2',
            compactAddButtons ? 'w-full' : 'sm:flex-row sm:items-stretch'
          )}
        >
          {compactAddButtons ? (
            <Button
              type="button"
              className={cn(CHANNEL_MANAGER_SEARCH_CONTROL_CLASS, 'w-full')}
              onClick={requestOpenChannelSearch}
            >
              הוספת ערוצים
            </Button>
          ) : (
            <div className={cn('flex-1', CHANNEL_MANAGER_SEARCH_SHELL_CLASS)}>
              <Button
                type="button"
                className={cn(CHANNEL_MANAGER_SEARCH_CONTROL_CLASS, 'w-full')}
                onClick={requestOpenChannelSearch}
              >
                הוספת ערוצים
              </Button>
            </div>
          )}
          {user?.id || ownerUserId || localParent.localAccessToken ? (
            <ChannelManagerVideoSearch
              className={compactAddButtons ? 'w-full' : 'flex-1'}
              userId={user?.id ? (ownerUserId ?? user.id) : null}
              childAccessToken={user?.id ? null : localParent.localAccessToken}
              mode={user?.id ? 'parent' : 'kid'}
              onOpenRequest={requestOpenVideoSearch}
              openSignal={videoSearchOpenSignal}
              compactTrigger={compactAddButtons}
            />
          ) : null}
        </div>
      </header>

      {devLoading || (listLoading && whitelist.length === 0) ? (
        embedded ? null : <Skeleton className="h-32 w-full" />
      ) : devices.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-zinc-400">הוסיפו מכשיר כדי לנהל ערוצים.</p>
      ) : embeddedEmptyChannels ? null : (
        <div className="flex flex-col gap-2">
          <WhitelistView
            channels={whitelist}
            onRemoveRequest={requestRemoveChannel}
            onPreviewRequest={(c, opts) => {
              preferredPreviewVideoIdRef.current = opts?.videoId ?? null
              setPreviewVideoSearch(opts?.videoSearch ?? '')
              setPreviewChannel(c)
              if (opts?.videoId) setActivePreviewVideoId(opts.videoId)
            }}
            onOpenSearch={requestOpenChannelSearch}
            canMultiSelect={canUsePlaylists}
            canBulkTag={canBulkTag}
            selectionMode={channelMultiSelect.selectionMode}
            selectedIds={channelMultiSelect.selectedIds}
            onEnterSelectionMode={channelMultiSelect.enterSelectionMode}
            onExitSelectionMode={() => {
              channelMultiSelect.exitSelectionMode()
              setBulkTagIds(new Set())
            }}
            onToggleSelect={channelMultiSelect.toggle}
            onSelectAll={(ids) => channelMultiSelect.selectMany(ids)}
            onClearSelection={channelMultiSelect.clear}
            onBulkAddToPlaylist={() => void handleBulkAddChannelsToPlaylist()}
            onBulkRemoveRequest={requestBulkRemoveChannels}
            bulkLoading={channelBulkLoading || removeLoading}
            bulkTagToolbar={
              canBulkTag ? (
                <ChannelTagBulkToolbar
                  tags={tagCatalog}
                  selectedChannelCount={channelMultiSelect.selectedIds.size}
                  selectedTagIds={bulkTagIds}
                  onToggleTag={toggleBulkTag}
                  onApply={() => void handleBulkApplyTags()}
                  applying={bulkTagApplying}
                />
              ) : null
            }
          />
          {previewChannel ? (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
                  ניגון ערוץ: {previewChannel.channel_name}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    className="!px-3 !py-2 text-xs"
                    onClick={() => requestRemoveChannel(previewChannel)}
                  >
                    הסר ערוץ
                  </Button>
                  <Button
                    variant="secondary"
                    className="!px-3 !py-2 text-xs"
                    onClick={() => setPreviewChannel(null)}
                  >
                    סגור נגן
                  </Button>
                </div>
              </div>
              {previewLoading ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">טוען סרטונים מהמטמון…</p>
              ) : previewError ? (
                <p className="text-sm text-danger-600">{previewError}</p>
              ) : previewVideos.length > 0 && visiblePreviewVideos.length === 0 && !previewVideoSearch.trim() ? (
                <p className="text-sm text-slate-600 dark:text-zinc-400">אין סרטונים זמינים להצגה בערוץ הזה.</p>
              ) : previewVideos.length > 0 && !activePreviewVideo && previewVideoSearch.trim() ? (
                <div className="flex flex-col gap-3">
                  <ChannelVideoSearchBar
                    id="parent-channel-video-search-filter-miss"
                    value={previewVideoSearch}
                    onChange={setPreviewVideoSearch}
                    totalCount={baseVisiblePreviewCount}
                    filteredCount={0}
                    channelLabel={previewChannel.channel_name}
                  />
                  <p className="text-center text-sm text-slate-600 dark:text-zinc-400">
                    אין סרטונים שמתאימים לחיפוש.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mx-auto !px-4 !py-2 text-xs"
                    onClick={() => setPreviewVideoSearch('')}
                  >
                    נקה חיפוש
                  </Button>
                </div>
              ) : activePreviewVideo ? (
                <>
                  {/* Mobile: search above the player so new users find it immediately */}
                  <div className="mb-3 xl:hidden">
                    <ChannelVideoSearchBar
                      id="parent-channel-video-search-mobile"
                      value={previewVideoSearch}
                      onChange={setPreviewVideoSearch}
                      totalCount={baseVisiblePreviewCount}
                      filteredCount={visiblePreviewVideos.length}
                      channelLabel={previewChannel.channel_name}
                    />
                  </div>
                  <YoutubeWatchLayout
                  className="mt-2"
                  main={
                    <>
                      <div className="relative w-full overflow-hidden rounded-none bg-black sm:rounded-xl">
                        <CleanPlayer
                          videoId={activePreviewVideo.videoId}
                          title={activePreviewVideo.title}
                          channelTitle={previewChannel.channel_name}
                          posterUrl={activePreviewVideo.thumbnail}
                          onPreviousTrack={goPrevManagerPreview}
                          onNextTrack={goNextManagerPreview}
                          hasNextTrack={hasNextPreviewVideo}
                          className="w-full"
                        />
                      </div>
                      <YoutubeWatchVideoDetails
                        title={activePreviewVideo.title}
                        channelName={previewChannel.channel_name}
                        actions={
                          <>
                            <div className="flex flex-wrap gap-2">
                              <YoutubeLikeButton videoId={activePreviewVideo.videoId} />
                              {hideVideoCtx.canQuickBlock ? (
                                <QuickBlockButton
                                  video={{
                                    youtube_video_id: activePreviewVideo.videoId,
                                    title: activePreviewVideo.title,
                                    thumbnail_url: activePreviewVideo.thumbnail,
                                    youtube_channel_id: previewChannel.youtube_channel_id,
                                    channel_name: previewChannel.channel_name,
                                  }}
                                  deviceId={hideVideoCtx.deviceId}
                                  localAccessToken={hideVideoCtx.localAccessToken}
                                  cachedPin={hideVideoCtx.cachedPin}
                                  verifyPin={hideVideoCtx.verifyPin}
                                  onSuccess={() => handleHidden(activePreviewVideo.videoId)}
                                />
                              ) : null}
                              {user?.id || localParent.localAccessToken ? (
                                <AddToPlaylistButton
                                  mode={user?.id ? 'parent' : 'kid'}
                                  userId={user?.id ? (ownerUserId ?? user.id) : null}
                                  childAccessToken={user?.id ? null : localParent.localAccessToken}
                                  variant="save"
                                  video={{
                                    youtube_video_id: activePreviewVideo.videoId,
                                    title: activePreviewVideo.title,
                                    thumbnail_url: activePreviewVideo.thumbnail,
                                    youtube_channel_id: previewChannel.youtube_channel_id,
                                    channel_name: previewChannel.channel_name,
                                  }}
                                />
                              ) : null}
                            </div>
                          </>
                        }
                      />
                    </>
                  }
                  sidebar={
                    <>
                      <ChannelVideoSearchBar
                        id="parent-channel-video-search"
                        value={previewVideoSearch}
                        onChange={setPreviewVideoSearch}
                        totalCount={baseVisiblePreviewCount}
                        filteredCount={visiblePreviewVideos.length}
                        channelLabel={previewChannel.channel_name}
                        className="mb-3 hidden xl:block"
                      />
                      {canUsePlaylists ? (
                        <PlaylistMultiSelectToolbar
                          className="mb-3"
                          compact
                          selectionMode={videoMultiSelect.selectionMode}
                          selectedCount={videoMultiSelect.selectedCount}
                          totalVisible={visiblePreviewVideos.length}
                          onEnterSelectionMode={videoMultiSelect.enterSelectionMode}
                          onExitSelectionMode={videoMultiSelect.exitSelectionMode}
                          onClearSelection={videoMultiSelect.clear}
                          onSelectAllVisible={() =>
                            videoMultiSelect.selectMany(visiblePreviewVideos.map(toPreviewPlaylistPayload))
                          }
                          onAddToPlaylist={() => setBulkPlaylistOpen(true)}
                        />
                      ) : null}
                      <YoutubeSuggestedList title="הבא בתור">
                        {visiblePreviewVideos.map((v) => {
                          const isCurrent = v.videoId === activePreviewVideoId
                          const payload = toPreviewPlaylistPayload(v)
                          return (
                            <li key={v.videoId} className="w-full">
                              <YoutubeVideoCard
                                layout="row"
                                title={v.title}
                                thumbnail={v.thumbnail}
                                durationLabel={formatVideoDurationClock(v.durationSeconds)}
                                active={isCurrent}
                                playingLabel="מנגן"
                                onClick={() => {
                                  if (videoMultiSelect.selectionMode) {
                                    videoMultiSelect.toggle(payload)
                                    return
                                  }
                                  handlePickPreviewVideo(v.videoId)
                                }}
                                thumbnailAction={
                                  hideVideoCtx.canQuickBlock ? (
                                    <QuickBlockButton
                                      video={{
                                        youtube_video_id: v.videoId,
                                        title: v.title,
                                        thumbnail_url: v.thumbnail,
                                        youtube_channel_id: previewChannel.youtube_channel_id,
                                        channel_name: previewChannel.channel_name,
                                      }}
                                      deviceId={hideVideoCtx.deviceId}
                                      localAccessToken={hideVideoCtx.localAccessToken}
                                      cachedPin={hideVideoCtx.cachedPin}
                                      verifyPin={hideVideoCtx.verifyPin}
                                      onSuccess={() => handleHidden(v.videoId)}
                                    />
                                  ) : null
                                }
                                actionSlot={
                                  canUsePlaylists ? (
                                    videoMultiSelect.selectionMode ? (
                                      <PlaylistSelectCheckbox
                                        checked={videoMultiSelect.isSelected(v.videoId)}
                                        onChange={() => videoMultiSelect.toggle(payload)}
                                      />
                                    ) : (
                                      <AddToPlaylistButton
                                        mode={playlistMode}
                                        userId={playlistUserId}
                                        childAccessToken={playlistChildToken}
                                        compact
                                        video={payload}
                                      />
                                    )
                                  ) : null
                                }
                              />
                            </li>
                          )
                        })}
                      </YoutubeSuggestedList>
                      {visiblePreviewVideos.length === 0 ? (
                        <p className="py-6 text-center text-sm text-yt-textMuted">
                          {previewVideoSearch.trim()
                            ? 'אין סרטונים שמתאימים לחיפוש.'
                            : 'אין סרטונים.'}
                        </p>
                      ) : null}
                      {!previewVideoSearch.trim() &&
                      (whitelist.find((c) => c.id === previewChannel.id)?.videos_cache_has_more ??
                        previewChannel.videos_cache_has_more) ? (
                        <div className="mt-3 flex justify-center pb-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={previewLoadingMore || previewRefreshing}
                            onClick={() => void handleLoadMorePreviewVideos()}
                          >
                            {previewLoadingMore
                              ? t('channels.loadingOlderVideos')
                              : t('channels.loadOlderVideos')}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  }
                />
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <p className="text-sm text-slate-600 dark:text-zinc-400">
                    {previewRefreshing ? t('channels.refreshingCache') : t('channels.emptyCache')}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={previewRefreshing}
                    onClick={() => void handleRefreshPreviewFromYouTube()}
                  >
                    {previewRefreshing ? t('channels.refreshingFromChannel') : t('channels.refreshFromChannel')}
                  </Button>
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}

      <TopicDiscoveryModal
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false)
          setAddedSearchChannelIds(new Set())
        }}
        onAddChannel={requestAddChannel}
        onAddChannels={requestAddChannels}
        onRemoveChannel={requestRemoveByYoutubeChannelId}
        addingId={addingId}
        addedIds={addedSearchChannelIds}
        whitelistedChannelIds={whitelistedChannelIds}
        deviceLabel={selectedDevice?.name}
      />

      <RemoveChannelModal
        open={Boolean(removeTarget)}
        channel={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        loading={removeLoading}
      />

      <Modal
        open={Boolean(bulkRemoveTargets?.length)}
        onClose={() => {
          if (!removeLoading) setBulkRemoveTargets(null)
        }}
        title={t('channels.removeManyTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkRemoveTargets(null)} disabled={removeLoading}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void confirmBulkRemove()} disabled={removeLoading}>
              {removeLoading
                ? t('common.removing')
                : t('channels.removeSelected', { count: bulkRemoveTargets?.length ?? 0 })}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-zinc-400">
          {t('channels.removeConfirmMany', { count: bulkRemoveTargets?.length ?? 0 })}
        </p>
      </Modal>

      <ParentalPinModal
        open={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false)
          pendingPinActionRef.current = null
        }}
        verifyPin={verifyChannelParentPin}
        onVerified={(pin) => runAfterVerifiedPin(pin.replace(/\D/g, '').trim())}
        title={t('channels.parentVerifyTitle')}
        description={t('channels.parentVerifyDescription')}
      />

      <ChannelAddedSuccessModal
        open={addSuccessModalOpen}
        channelName={lastAddedChannelName}
        addedCount={addSuccessCount}
        busy={addSuccessTagSaving}
        onContinueAdding={() => void closeAddSuccessModal('more')}
        onGoToChannelsList={() => void closeAddSuccessModal('done')}
      >
        {CONTENT_TAGS_ENABLED && lastAddedChannelId ? (
          <TagOnAddPrompt
            tags={tagCatalog}
            selectedTagIds={addSuccessTagIds}
            onToggleTag={toggleAddSuccessTag}
            disabled={addSuccessTagSaving}
          />
        ) : null}
      </ChannelAddedSuccessModal>

      {canUsePlaylists ? (
        <AddToPlaylistModal
          open={bulkPlaylistOpen}
          onClose={() => setBulkPlaylistOpen(false)}
          mode={playlistMode}
          userId={playlistUserId}
          childAccessToken={playlistChildToken}
          videos={videoMultiSelect.selectedVideos}
          onSuccess={() => {
            videoMultiSelect.exitSelectionMode()
            setBulkPlaylistOpen(false)
          }}
        />
      ) : null}

      {canUsePlaylists ? (
        <AddToPlaylistModal
          open={channelBulkOpen}
          onClose={() => {
            setChannelBulkOpen(false)
            setChannelBulkVideos([])
          }}
          mode={playlistMode}
          userId={playlistUserId}
          childAccessToken={playlistChildToken}
          videos={channelBulkVideos}
          onSuccess={() => {
            channelMultiSelect.exitSelectionMode()
            setChannelBulkOpen(false)
            setChannelBulkVideos([])
          }}
        />
      ) : null}
    </div>
  )
}
