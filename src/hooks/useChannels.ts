import { useCallback, useEffect } from 'react'
import { getSavedChildAccessToken } from '../lib/childDevice'
import { getParentPinSession } from '../lib/parentPinSession'
import {
  CHANNEL_CACHE_APPEND_PAGES,
  CHANNEL_CACHE_INITIAL_PAGES,
  extractYouTubeVideoId,
  getLatestVideosForChannel,
  resolveYouTubeChannelFromInput,
  searchYouTubeChannels,
  searchYouTubeVideos,
} from '../lib/youtube'
import { useChannelStore } from '../stores/channelStore'
import { supabase } from '../lib/supabase'
import type { WhitelistedChannel } from '../types'

const CHANNEL_CACHE_INSERT_CHUNK = 500
/** אצוות קטנות יותר ל־RPC (גודל גוף JSON) */
const LOCAL_PARENT_CACHE_RPC_CHUNK = 350
/** Delay between background append pages (quota-friendly). */
const BACKGROUND_APPEND_DELAY_MS = 2500
/** Soft ceiling for unattended background pages per channel (further pages via scroll). */
const BACKGROUND_APPEND_MAX_PAGES = 40

type CacheFillMode = 'initial' | 'append' | 'replace'

function patchWhitelistCursor(
  channelDbId: string,
  patch: Partial<
    Pick<
      WhitelistedChannel,
      | 'videos_cache_has_more'
      | 'videos_cache_next_page_token'
      | 'videos_cache_uploads_playlist_id'
      | 'last_videos_refresh_at'
    >
  >
) {
  const list = useChannelStore.getState().whitelist
  const idx = list.findIndex((c) => c.id === channelDbId)
  if (idx < 0) return
  const next = [...list]
  next[idx] = { ...next[idx], ...patch }
  useChannelStore.getState().setWhitelist(next)
}

export function useChannels(
  deviceId: string | undefined,
  userId: string | undefined,
  options?: {
    localAccessToken?: string | null
    getLocalParentPin?: () => string | null
  }
) {
  const localAccessToken = options?.localAccessToken ?? null
  const getLocalParentPin = options?.getLocalParentPin

  const resolveParentPinForAuthMutation = useCallback(() => {
    return (getLocalParentPin?.() || getParentPinSession() || '').replace(/\D/g, '').trim()
  }, [getLocalParentPin])
  const whitelist = useChannelStore((s) => s.whitelist)
  const searchResults = useChannelStore((s) => s.searchResults)
  const approvedVideos = useChannelStore((s) => s.approvedVideos)
  const videoSearchResults = useChannelStore((s) => s.videoSearchResults)
  const searchLoading = useChannelStore((s) => s.searchLoading)
  const videoSearchLoading = useChannelStore((s) => s.videoSearchLoading)
  const searchError = useChannelStore((s) => s.searchError)
  const videoSearchError = useChannelStore((s) => s.videoSearchError)
  const loading = useChannelStore((s) => s.loading)
  const fetchWhitelistForDevice = useChannelStore((s) => s.fetchWhitelistForDevice)
  const fetchApprovedVideosForDevice = useChannelStore((s) => s.fetchApprovedVideosForDevice)
  const setSearchResults = useChannelStore((s) => s.setSearchResults)
  const setVideoSearchResults = useChannelStore((s) => s.setVideoSearchResults)
  const setSearchLoading = useChannelStore((s) => s.setSearchLoading)
  const setVideoSearchLoading = useChannelStore((s) => s.setVideoSearchLoading)
  const setSearchError = useChannelStore((s) => s.setSearchError)
  const setVideoSearchError = useChannelStore((s) => s.setVideoSearchError)
  const addChannelToDevice = useChannelStore((s) => s.addChannelToDevice)
  const addVideoToDevice = useChannelStore((s) => s.addVideoToDevice)
  const removeChannelFromDevice = useChannelStore((s) => s.removeChannelFromDevice)
  const removeVideoFromDevice = useChannelStore((s) => s.removeVideoFromDevice)
  const fetchWhitelistForLocalParent = useChannelStore((s) => s.fetchWhitelistForLocalParent)
  const fetchWhitelistFromChildToken = useChannelStore((s) => s.fetchWhitelistFromChildToken)
  const addChannelLocalParent = useChannelStore((s) => s.addChannelLocalParent)
  const removeChannelLocalParent = useChannelStore((s) => s.removeChannelLocalParent)
  const replaceChannelCacheLocalParent = useChannelStore((s) => s.replaceChannelCacheLocalParent)

  const refreshChannelVideosCache = useCallback(
    async (
      channelDbId: string,
      youtubeChannelId: string,
      forceOrMode: boolean | CacheFillMode = false
    ) => {
      const chMeta = useChannelStore.getState().whitelist.find((c) => c.id === channelDbId)
      let mode: CacheFillMode =
        typeof forceOrMode === 'string' ? forceOrMode : forceOrMode ? 'replace' : 'replace'
      // Legacy `force=false` means "skip if fresh" for stale backfill.
      const skipIfFresh = forceOrMode === false

      if (skipIfFresh) {
        const last = chMeta?.last_videos_refresh_at ? new Date(chMeta.last_videos_refresh_at).getTime() : 0
        // Keep channel feeds closer to YouTube (was 24h).
        const isFresh = last > 0 && Date.now() - last < 30 * 60 * 1000
        if (isFresh && !chMeta?.videos_cache_has_more) {
          return { error: null, appended: 0, hasMore: false }
        }
        if (isFresh && chMeta?.videos_cache_has_more) {
          mode = 'append'
        }
      }

      const isAppend = mode === 'append'
      const clearExisting = mode === 'initial' || mode === 'replace'

      let pageToken: string | null | undefined = isAppend
        ? chMeta?.videos_cache_next_page_token ?? null
        : null
      let uploadsPlaylistId: string | null | undefined = isAppend
        ? chMeta?.videos_cache_uploads_playlist_id ?? null
        : null

      if (isAppend && !localAccessToken) {
        const { data: meta } = await supabase
          .from('whitelisted_channels')
          .select(
            'videos_cache_next_page_token, videos_cache_uploads_playlist_id, videos_cache_has_more, last_videos_refresh_at'
          )
          .eq('id', channelDbId)
          .maybeSingle()
        pageToken = (meta as { videos_cache_next_page_token?: string | null } | null)
          ?.videos_cache_next_page_token
        uploadsPlaylistId = (meta as { videos_cache_uploads_playlist_id?: string | null } | null)
          ?.videos_cache_uploads_playlist_id
        const hasMoreDb = Boolean(
          (meta as { videos_cache_has_more?: boolean } | null)?.videos_cache_has_more
        )
        if (!pageToken || !hasMoreDb) {
          return { error: null, appended: 0, hasMore: false }
        }
      }

      if (isAppend && !pageToken) {
        return { error: null, appended: 0, hasMore: false }
      }

      const maxPages = isAppend ? CHANNEL_CACHE_APPEND_PAGES : CHANNEL_CACHE_INITIAL_PAGES
      const { data: videos, error: ytError, nextPageToken, hasMore, uploadsPlaylistId: playlistId } =
        await getLatestVideosForChannel(youtubeChannelId, {
          maxPages,
          pageToken: isAppend ? pageToken : null,
          uploadsPlaylistId: uploadsPlaylistId || null,
        })
      if (ytError) return { error: ytError, appended: 0, hasMore: false }

      const fetched = videos ?? []
      if (fetched.length === 0 && !isAppend) {
        return { error: null, appended: 0, hasMore: false }
      }

      let positionOffset = 0
      if (isAppend) {
        if (localAccessToken) {
          const pin = getLocalParentPin?.() ?? ''
          const { data: listed } = await supabase.rpc('local_parent_list_channel_videos', {
            p_access_token: localAccessToken,
            p_pin: pin,
            p_youtube_channel_id: youtubeChannelId,
          })
          const rows = Array.isArray(listed) ? listed : []
          positionOffset = rows.length
        } else {
          const { count } = await supabase
            .from('channel_videos_cache')
            .select('*', { count: 'exact', head: true })
            .eq('channel_id', channelDbId)
          positionOffset = count ?? 0
        }
      }

      const cursor = {
        nextPageToken: nextPageToken ?? null,
        uploadsPlaylistId: playlistId || uploadsPlaylistId || null,
        hasMore: Boolean(hasMore),
      }

      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        const rows = fetched.map((v, idx) => ({
          youtube_video_id: v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || null,
          published_at: null as string | null,
          position: positionOffset + idx,
          duration_seconds: v.durationSeconds ?? null,
        }))
        if (rows.length === 0) {
          const rep = await replaceChannelCacheLocalParent({
            accessToken: localAccessToken,
            pin,
            channelDbId,
            videos: [],
            clearExisting: false,
            nextPageToken: cursor.nextPageToken,
            uploadsPlaylistId: cursor.uploadsPlaylistId,
            hasMore: cursor.hasMore,
          })
          if (rep.error) return { error: rep.error, appended: 0, hasMore: cursor.hasMore }
        } else {
          for (let offset = 0; offset < rows.length; offset += LOCAL_PARENT_CACHE_RPC_CHUNK) {
            const slice = rows.slice(offset, offset + LOCAL_PARENT_CACHE_RPC_CHUNK)
            const isFirst = offset === 0
            const rep = await replaceChannelCacheLocalParent({
              accessToken: localAccessToken,
              pin,
              channelDbId,
              videos: slice,
              clearExisting: clearExisting && isFirst,
              nextPageToken: cursor.nextPageToken,
              uploadsPlaylistId: cursor.uploadsPlaylistId,
              hasMore: cursor.hasMore,
            })
            if (rep.error) return { error: rep.error, appended: 0, hasMore: cursor.hasMore }
          }
        }
        await fetchWhitelistForLocalParent(localAccessToken)
        return { error: null, appended: fetched.length, hasMore: cursor.hasMore }
      }

      if (clearExisting) {
        const { error: deleteError } = await supabase
          .from('channel_videos_cache')
          .delete()
          .eq('channel_id', channelDbId)
        if (deleteError) return { error: new Error(deleteError.message), appended: 0, hasMore: false }
      }

      if (fetched.length > 0) {
        const rows = fetched.map((v, idx) => ({
          channel_id: channelDbId,
          youtube_video_id: v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || null,
          published_at: null as string | null,
          position: positionOffset + idx,
          duration_seconds: v.durationSeconds ?? null,
        }))
        for (let offset = 0; offset < rows.length; offset += CHANNEL_CACHE_INSERT_CHUNK) {
          const slice = rows.slice(offset, offset + CHANNEL_CACHE_INSERT_CHUNK)
          const { error: insertError } = await supabase.from('channel_videos_cache').upsert(slice, {
            onConflict: 'channel_id,youtube_video_id',
          })
          if (insertError) return { error: new Error(insertError.message), appended: 0, hasMore: false }
        }
      }

      const { error: updateError } = await supabase
        .from('whitelisted_channels')
        .update({
          last_videos_refresh_at: new Date().toISOString(),
          videos_cache_next_page_token: cursor.nextPageToken,
          videos_cache_uploads_playlist_id: cursor.uploadsPlaylistId,
          videos_cache_has_more: cursor.hasMore,
        })
        .eq('id', channelDbId)
      if (updateError) return { error: new Error(updateError.message), appended: 0, hasMore: false }

      patchWhitelistCursor(channelDbId, {
        last_videos_refresh_at: new Date().toISOString(),
        videos_cache_next_page_token: cursor.nextPageToken,
        videos_cache_uploads_playlist_id: cursor.uploadsPlaylistId,
        videos_cache_has_more: cursor.hasMore,
      })

      if (deviceId) await fetchWhitelistForDevice(deviceId)
      return { error: null, appended: fetched.length, hasMore: cursor.hasMore }
    },
    [
      deviceId,
      fetchWhitelistForDevice,
      localAccessToken,
      getLocalParentPin,
      replaceChannelCacheLocalParent,
      fetchWhitelistForLocalParent,
    ]
  )

  const appendChannelVideosCache = useCallback(
    async (channelDbId: string, youtubeChannelId: string) => {
      return refreshChannelVideosCache(channelDbId, youtubeChannelId, 'append')
    },
    [refreshChannelVideosCache]
  )

  /** Background: initial small batch, then paced appends until caught up or soft ceiling. */
  const scheduleChannelVideosCacheRefresh = useCallback(
    (channelDbId: string, youtubeChannelId: string) => {
      void (async () => {
        const initial = await refreshChannelVideosCache(channelDbId, youtubeChannelId, 'initial')
        if (initial.error) {
          console.warn(
            '[useChannels] initial cache fill failed',
            initial.error.message,
            youtubeChannelId
          )
          return
        }
        let pages = 0
        let hasMore = Boolean(initial.hasMore)
        while (hasMore && pages < BACKGROUND_APPEND_MAX_PAGES) {
          await new Promise((r) => setTimeout(r, BACKGROUND_APPEND_DELAY_MS))
          const next = await refreshChannelVideosCache(channelDbId, youtubeChannelId, 'append')
          if (next.error) {
            console.warn(
              '[useChannels] background cache append failed',
              next.error.message,
              youtubeChannelId
            )
            break
          }
          hasMore = Boolean(next.hasMore)
          pages += 1
          if ((next.appended ?? 0) === 0 && !hasMore) break
        }
      })()
    },
    [refreshChannelVideosCache]
  )

  const search = useCallback(
    async (query: string) => {
      setSearchLoading(true)
      setSearchError(null)
      const { data, error } = await searchYouTubeChannels(query)
      setSearchLoading(false)
      if (error) {
        setSearchError(error.message)
        setSearchResults([])
        return
      }
      setSearchResults(data ?? [])
    },
    [setSearchLoading, setSearchError, setSearchResults]
  )

  const loadWhitelist = useCallback(() => {
    const kidToken = getSavedChildAccessToken()
    if (kidToken) {
      void fetchWhitelistFromChildToken(kidToken)
      return
    }
    if (localAccessToken) {
      void fetchWhitelistForLocalParent(localAccessToken)
      return
    }
    if (deviceId) void fetchWhitelistForDevice(deviceId)
  }, [
    deviceId,
    localAccessToken,
    fetchWhitelistForDevice,
    fetchWhitelistForLocalParent,
    fetchWhitelistFromChildToken,
  ])

  useEffect(() => {
    loadWhitelist()
  }, [loadWhitelist])

  const loadApprovedVideos = useCallback(() => {
    if (deviceId) void fetchApprovedVideosForDevice(deviceId)
  }, [deviceId, fetchApprovedVideosForDevice])

  const searchVideos = useCallback(
    async (query: string) => {
      setVideoSearchLoading(true)
      setVideoSearchError(null)
      const { data, error } = await searchYouTubeVideos(query)
      setVideoSearchLoading(false)
      if (error) {
        setVideoSearchError(error.message)
        setVideoSearchResults([])
        return
      }
      setVideoSearchResults(data ?? [])
    },
    [setVideoSearchLoading, setVideoSearchError, setVideoSearchResults]
  )

  const addVideoByUrlOrId = useCallback(
    async (input: string) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      const videoId = extractYouTubeVideoId(input)
      if (!videoId) return { error: new Error('לא הצלחתי לזהות מזהה סרטון מהקישור') }
      const { data, error } = await searchYouTubeVideos(videoId)
      if (error) return { error }
      const candidate = (data ?? []).find((v) => v.videoId === videoId) ?? {
        videoId,
        title: `Video ${videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        channelTitle: '',
      }
      return addVideoToDevice({
        deviceId,
        userId,
        yt: candidate,
        parentPin: resolveParentPinForAuthMutation(),
      })
    },
    [deviceId, userId, addVideoToDevice, resolveParentPinForAuthMutation]
  )

  const addToWhitelist = useCallback(
    async (yt: import('../types').YouTubeChannelResult, category?: string | null) => {
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        const res = await addChannelLocalParent({ accessToken: localAccessToken, pin, yt, category })
        if (res.error) return { ...res, cacheError: null as Error | null }
        const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === yt.channelId)
        if (ch?.id) scheduleChannelVideosCacheRefresh(ch.id, yt.channelId)
        return { error: null, cacheError: null }
      }
      if (!deviceId || !userId) return { error: new Error('לא מחובר'), cacheError: null }
      const res = await addChannelToDevice({
        deviceId,
        userId,
        yt,
        category,
        parentPin: resolveParentPinForAuthMutation(),
      })
      if (res.error) return { ...res, cacheError: null as Error | null }
      const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === yt.channelId)
      if (ch?.id) scheduleChannelVideosCacheRefresh(ch.id, yt.channelId)
      return { error: null, cacheError: null }
    },
    [
      deviceId,
      userId,
      localAccessToken,
      getLocalParentPin,
      addChannelLocalParent,
      addChannelToDevice,
      scheduleChannelVideosCacheRefresh,
      resolveParentPinForAuthMutation,
    ]
  )

  const addChannelByUrlOrId = useCallback(
    async (input: string, category?: string | null) => {
      const { data, error } = await resolveYouTubeChannelFromInput(input)
      if (error || !data) return { error: error ?? new Error('לא נמצא ערוץ מהקישור'), cacheError: null }
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        const res = await addChannelLocalParent({ accessToken: localAccessToken, pin, yt: data, category })
        if (res.error) return { ...res, cacheError: null as Error | null }
        const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === data.channelId)
        if (ch?.id) scheduleChannelVideosCacheRefresh(ch.id, data.channelId)
        return { error: null, cacheError: null }
      }
      if (!deviceId || !userId) return { error: new Error('לא מחובר'), cacheError: null }
      const res = await addChannelToDevice({
        deviceId,
        userId,
        yt: data,
        category,
        parentPin: resolveParentPinForAuthMutation(),
      })
      if (res.error) return { ...res, cacheError: null as Error | null }
      const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === data.channelId)
      if (ch?.id) scheduleChannelVideosCacheRefresh(ch.id, data.channelId)
      return { error: null, cacheError: null }
    },
    [
      deviceId,
      userId,
      localAccessToken,
      getLocalParentPin,
      addChannelLocalParent,
      addChannelToDevice,
      scheduleChannelVideosCacheRefresh,
      resolveParentPinForAuthMutation,
    ]
  )

  const removeFromWhitelist = useCallback(
    async (channelId: string) => {
      if (!deviceId) return { error: new Error('לא נבחר מכשיר') }
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        return removeChannelLocalParent(localAccessToken, pin, channelId)
      }
      if (!userId) return { error: new Error('לא מחובר') }
      return removeChannelFromDevice(deviceId, channelId, {
        userId,
        parentPin: resolveParentPinForAuthMutation(),
      })
    },
    [
      deviceId,
      userId,
      localAccessToken,
      getLocalParentPin,
      removeChannelLocalParent,
      removeChannelFromDevice,
      resolveParentPinForAuthMutation,
    ]
  )

  const addToApprovedVideos = useCallback(
    async (yt: import('../types').YouTubeVideoResult) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      return addVideoToDevice({
        deviceId,
        userId,
        yt,
        parentPin: resolveParentPinForAuthMutation(),
      })
    },
    [deviceId, userId, addVideoToDevice, resolveParentPinForAuthMutation]
  )

  const removeFromApprovedVideos = useCallback(
    async (videoId: string) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      return removeVideoFromDevice(deviceId, videoId, {
        userId,
        parentPin: resolveParentPinForAuthMutation(),
      })
    },
    [deviceId, userId, removeVideoFromDevice, resolveParentPinForAuthMutation]
  )

  return {
    whitelist,
    approvedVideos,
    searchResults,
    videoSearchResults,
    searchLoading,
    videoSearchLoading,
    searchError,
    videoSearchError,
    loading,
    search,
    searchVideos,
    loadWhitelist,
    loadApprovedVideos,
    addVideoByUrlOrId,
    addChannelByUrlOrId,
    refreshChannelVideosCache,
    appendChannelVideosCache,
    addToWhitelist,
    addToApprovedVideos,
    removeFromWhitelist,
    removeFromApprovedVideos,
  }
}
