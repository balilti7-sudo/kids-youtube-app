import { useCallback } from 'react'
import { searchYouTubeChannels } from '../lib/youtube'
import { useChannelStore } from '../stores/channelStore'

export function useChannels(deviceId: string | undefined, userId: string | undefined) {
  const whitelist = useChannelStore((s) => s.whitelist)
  const searchResults = useChannelStore((s) => s.searchResults)
  const searchLoading = useChannelStore((s) => s.searchLoading)
  const searchError = useChannelStore((s) => s.searchError)
  const loading = useChannelStore((s) => s.loading)
  const fetchWhitelistForDevice = useChannelStore((s) => s.fetchWhitelistForDevice)
  const setSearchResults = useChannelStore((s) => s.setSearchResults)
  const setSearchLoading = useChannelStore((s) => s.setSearchLoading)
  const setSearchError = useChannelStore((s) => s.setSearchError)
  const addChannelToDevice = useChannelStore((s) => s.addChannelToDevice)
  const removeChannelFromDevice = useChannelStore((s) => s.removeChannelFromDevice)

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

  const addToWhitelist = useCallback(
    async (yt: import('../types').YouTubeChannelResult) => {
      if (!deviceId || !userId) return { error: new Error('לא מחובר') }
      return addChannelToDevice({ deviceId, userId, yt })
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

  return {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading,
    search,
    loadWhitelist,
    addToWhitelist,
    removeFromWhitelist,
  }
}
