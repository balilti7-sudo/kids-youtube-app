import { useCallback } from 'react'
import { extractYouTubeVideoId, resolveYouTubeChannelFromInput, searchYouTubeChannels, searchYouTubeVideos } from '../lib/youtube'
import { useChannelStore } from '../stores/channelStore'

export function useChannels(deviceId: string | undefined, userId: string | undefined) {
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
    if (deviceId) void fetchWhitelistForDevice(deviceId)
  }, [deviceId, fetchWhitelistForDevice])

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
    async (yt: import('../types').YouTubeChannelResult) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      return addChannelToDevice({ deviceId, userId, yt })
    },
    [deviceId, userId, addChannelToDevice]
  )

  const addChannelByUrlOrId = useCallback(
    async (input: string) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      const { data, error } = await resolveYouTubeChannelFromInput(input)
      if (error || !data) return { error: error ?? new Error('לא נמצא ערוץ מהקישור') }
      return addChannelToDevice({ deviceId, userId, yt: data })
    },
    [deviceId, userId, addChannelToDevice]
  )

  const removeFromWhitelist = useCallback(
    async (channelId: string) => {
      if (!deviceId) return { error: new Error('לא נבחר מכשיר') }
      return removeChannelFromDevice(deviceId, channelId)
    },
    [deviceId, removeChannelFromDevice]
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
    addToWhitelist,
    addToApprovedVideos,
    removeFromWhitelist,
    removeFromApprovedVideos,
  }
}
