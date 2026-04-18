import { useCallback } from 'react'
import { extractYouTubeVideoId, resolveYouTubeChannelFromInput, searchYouTubeChannels, searchYouTubeVideos } from '../lib/youtube'
import { useChannelStore } from '../stores/channelStore'
import { supabase } from '../lib/supabase'
import { getLatestVideosForChannel } from '../lib/youtube'

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
  const addChannelLocalParent = useChannelStore((s) => s.addChannelLocalParent)
  const removeChannelLocalParent = useChannelStore((s) => s.removeChannelLocalParent)
  const replaceChannelCacheLocalParent = useChannelStore((s) => s.replaceChannelCacheLocalParent)

  const refreshChannelVideosCache = useCallback(
    async (channelDbId: string, youtubeChannelId: string, force = false) => {
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? null
        if (!pin) return { error: null }

        const chMeta = useChannelStore.getState().whitelist.find((c) => c.id === channelDbId)
        const last = chMeta?.last_videos_refresh_at ? new Date(chMeta.last_videos_refresh_at).getTime() : 0
        const isFresh = last > 0 && Date.now() - last < 24 * 60 * 60 * 1000
        if (!force && isFresh) return { error: null }

        const { data: videos, error: ytError } = await getLatestVideosForChannel(youtubeChannelId)
        if (ytError) return { error: ytError }

        const rows = (videos ?? []).map((v, idx) => ({
          youtube_video_id: v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || null,
          published_at: null as string | null,
          position: idx,
        }))
        const rep = await replaceChannelCacheLocalParent({
          accessToken: localAccessToken,
          pin,
          channelDbId,
          videos: rows,
        })
        if (rep.error) return rep
        await fetchWhitelistForLocalParent(localAccessToken)
        return { error: null }
      }

      const { data: meta, error: metaError } = await supabase
        .from('whitelisted_channels')
        .select('last_videos_refresh_at')
        .eq('id', channelDbId)
        .maybeSingle()
      if (metaError) return { error: new Error(metaError.message) }

      const last = meta?.last_videos_refresh_at ? new Date(meta.last_videos_refresh_at).getTime() : 0
      const isFresh = last > 0 && Date.now() - last < 24 * 60 * 60 * 1000
      if (!force && isFresh) return { error: null }

      const { data: videos, error: ytError } = await getLatestVideosForChannel(youtubeChannelId)
      if (ytError) return { error: ytError }

      const { error: deleteError } = await supabase.from('channel_videos_cache').delete().eq('channel_id', channelDbId)
      if (deleteError) return { error: new Error(deleteError.message) }

      if ((videos ?? []).length > 0) {
        const rows = (videos ?? []).map((v, idx) => ({
          channel_id: channelDbId,
          youtube_video_id: v.videoId,
          title: v.title,
          thumbnail_url: v.thumbnail || null,
          published_at: null,
          position: idx,
        }))
        const { error: insertError } = await supabase.from('channel_videos_cache').insert(rows)
        if (insertError) return { error: new Error(insertError.message) }
      }

      const { error: updateError } = await supabase
        .from('whitelisted_channels')
        .update({ last_videos_refresh_at: new Date().toISOString() })
        .eq('id', channelDbId)
      if (updateError) return { error: new Error(updateError.message) }

      if (deviceId) await fetchWhitelistForDevice(deviceId)
      return { error: null }
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
    if (localAccessToken) {
      void fetchWhitelistForLocalParent(localAccessToken)
      return
    }
    if (deviceId) void fetchWhitelistForDevice(deviceId)
  }, [deviceId, localAccessToken, fetchWhitelistForDevice, fetchWhitelistForLocalParent])

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
      return addVideoToDevice({ deviceId, userId, yt: candidate })
    },
    [deviceId, userId, addVideoToDevice]
  )

  const addToWhitelist = useCallback(
    async (yt: import('../types').YouTubeChannelResult, category?: string | null) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        if (!pin) return { error: new Error('לא מוכן PIN') }
        const res = await addChannelLocalParent({ accessToken: localAccessToken, pin, yt, category })
        if (res.error) return res
        const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === yt.channelId)
        if (ch?.id) {
          const ref = await refreshChannelVideosCache(ch.id, yt.channelId, true)
          if (ref.error) return ref
        }
        return { error: null }
      }
      const res = await addChannelToDevice({ deviceId, userId, yt, category })
      if (res.error) return res
      await fetchWhitelistForDevice(deviceId)
      const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === yt.channelId)
      if (ch?.id) {
        const ref = await refreshChannelVideosCache(ch.id, yt.channelId, true)
        if (ref.error) return ref
      }
      return { error: null }
    },
    [
      deviceId,
      userId,
      localAccessToken,
      getLocalParentPin,
      addChannelLocalParent,
      addChannelToDevice,
      fetchWhitelistForDevice,
      refreshChannelVideosCache,
    ]
  )

  const addChannelByUrlOrId = useCallback(
    async (input: string, category?: string | null) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      const { data, error } = await resolveYouTubeChannelFromInput(input)
      if (error || !data) return { error: error ?? new Error('לא נמצא ערוץ מהקישור') }
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        if (!pin) return { error: new Error('לא מוכן PIN') }
        const res = await addChannelLocalParent({ accessToken: localAccessToken, pin, yt: data, category })
        if (res.error) return res
        const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === data.channelId)
        if (ch?.id) {
          const ref = await refreshChannelVideosCache(ch.id, data.channelId, true)
          if (ref.error) return ref
        }
        return { error: null }
      }
      const res = await addChannelToDevice({ deviceId, userId, yt: data, category })
      if (res.error) return res
      await fetchWhitelistForDevice(deviceId)
      const ch = useChannelStore.getState().whitelist.find((c) => c.youtube_channel_id === data.channelId)
      if (ch?.id) {
        const ref = await refreshChannelVideosCache(ch.id, data.channelId, true)
        if (ref.error) return ref
      }
      return { error: null }
    },
    [
      deviceId,
      userId,
      localAccessToken,
      getLocalParentPin,
      addChannelLocalParent,
      addChannelToDevice,
      fetchWhitelistForDevice,
      refreshChannelVideosCache,
    ]
  )

  const removeFromWhitelist = useCallback(
    async (channelId: string) => {
      if (!deviceId) return { error: new Error('לא נבחר מכשיר') }
      if (localAccessToken) {
        const pin = getLocalParentPin?.() ?? ''
        if (!pin) return { error: new Error('לא מוכן PIN') }
        return removeChannelLocalParent(localAccessToken, pin, channelId)
      }
      return removeChannelFromDevice(deviceId, channelId)
    },
    [deviceId, localAccessToken, getLocalParentPin, removeChannelLocalParent, removeChannelFromDevice]
  )

  const addToApprovedVideos = useCallback(
    async (yt: import('../types').YouTubeVideoResult) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      return addVideoToDevice({ deviceId, userId, yt })
    },
    [deviceId, userId, addVideoToDevice]
  )

  const removeFromApprovedVideos = useCallback(
    async (videoId: string) => {
      if (!deviceId) return { error: new Error('לא נבחר מכשיר') }
      return removeVideoFromDevice(deviceId, videoId)
    },
    [deviceId, removeVideoFromDevice]
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
    addToWhitelist,
    addToApprovedVideos,
    removeFromWhitelist,
    removeFromApprovedVideos,
  }
}
