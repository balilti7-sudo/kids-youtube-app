import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchChannelPlaylists,
  fetchYoutubePlaylistVideos,
  type ChannelVideoItem,
  type YouTubeChannelPlaylist,
} from '../lib/youtube'

export function useChannelYoutubePlaylists(youtubeChannelId: string | null | undefined, enabled: boolean) {
  const [playlists, setPlaylists] = useState<YouTubeChannelPlaylist[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [playlistVideos, setPlaylistVideos] = useState<ChannelVideoItem[]>([])
  const [playlistVideosLoading, setPlaylistVideosLoading] = useState(false)
  const [playlistVideosError, setPlaylistVideosError] = useState<string | null>(null)
  const listGenRef = useRef(0)
  const videosGenRef = useRef(0)

  useEffect(() => {
    if (!enabled || !youtubeChannelId?.trim()) {
      setPlaylists([])
      setLoading(false)
      setError(null)
      return
    }

    const gen = ++listGenRef.current
    setLoading(true)
    setError(null)

    void fetchChannelPlaylists(youtubeChannelId).then((result) => {
      if (gen !== listGenRef.current) return
      setLoading(false)
      if (result.error) {
        setPlaylists([])
        setError(result.error.message)
        return
      }
      setPlaylists(result.data?.playlists ?? [])
    })
  }, [enabled, youtubeChannelId])

  useEffect(() => {
    if (!selectedPlaylistId) {
      setPlaylistVideos([])
      setPlaylistVideosLoading(false)
      setPlaylistVideosError(null)
      return
    }

    const gen = ++videosGenRef.current
    setPlaylistVideosLoading(true)
    setPlaylistVideosError(null)

    void fetchYoutubePlaylistVideos(selectedPlaylistId, { maxPages: 3 }).then((result) => {
      if (gen !== videosGenRef.current) return
      setPlaylistVideosLoading(false)
      if (result.error) {
        setPlaylistVideos([])
        setPlaylistVideosError(result.error.message)
        return
      }
      setPlaylistVideos(result.data?.videos ?? [])
    })
  }, [selectedPlaylistId])

  const clearSelectedPlaylist = useCallback(() => {
    setSelectedPlaylistId(null)
  }, [])

  return {
    playlists,
    loading,
    error,
    selectedPlaylistId,
    setSelectedPlaylistId,
    clearSelectedPlaylist,
    playlistVideos,
    playlistVideosLoading,
    playlistVideosError,
  }
}
