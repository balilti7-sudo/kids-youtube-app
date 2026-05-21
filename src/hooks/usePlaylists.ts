import { useCallback, useEffect, useState } from 'react'
import type { PlaylistVideoPayload, UserPlaylist } from '../lib/playlists'
import {
  addVideoToPlaylist,
  addVideoToPlaylistForChild,
  createPlaylistForChild,
  createPlaylistForUser,
  listPlaylistVideos,
  listPlaylistVideosForChild,
  listPlaylistsForChild,
  listPlaylistsForUser,
  playlistIdsContainingVideo,
  playlistIdsContainingVideoForChild,
  removeVideoFromPlaylist,
  removeVideoFromPlaylistForChild,
} from '../lib/playlists'

export type PlaylistMode = 'parent' | 'kid'

export function usePlaylists(opts: {
  mode: PlaylistMode
  userId: string | null
  childAccessToken: string | null
}) {
  const { mode, userId, childAccessToken } = opts
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([])
  const [loading, setLoading] = useState(false)

  const canLoad =
    mode === 'parent' ? Boolean(userId) : Boolean(childAccessToken)

  const refresh = useCallback(async () => {
    if (!canLoad) {
      setPlaylists([])
      return
    }
    setLoading(true)
    try {
      if (mode === 'parent' && userId) {
        const { data, error } = await listPlaylistsForUser(userId)
        if (error) throw error
        setPlaylists(data)
      } else if (mode === 'kid' && childAccessToken) {
        const { data, error } = await listPlaylistsForChild(childAccessToken)
        if (error) throw error
        setPlaylists(data)
      }
    } catch {
      setPlaylists([])
    } finally {
      setLoading(false)
    }
  }, [canLoad, mode, userId, childAccessToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createPlaylist = useCallback(
    async (name: string) => {
      if (mode === 'parent' && userId) {
        return createPlaylistForUser(userId, name)
      }
      if (mode === 'kid' && childAccessToken) {
        const trimmed = name.trim()
        const { data: id, error } = await createPlaylistForChild(childAccessToken, trimmed)
        if (error) return { data: null, error }
        await refresh()
        return {
          data: id ? { id, name: trimmed, video_count: 0, updated_at: '' } : null,
          error: null,
        }
      }
      return { data: null, error: new Error('לא מחובר') }
    },
    [mode, userId, childAccessToken, refresh, playlists]
  )

  const fetchVideos = useCallback(
    async (playlistId: string) => {
      if (mode === 'parent') return listPlaylistVideos(playlistId)
      if (childAccessToken) return listPlaylistVideosForChild(childAccessToken, playlistId)
      return { data: [], error: new Error('לא מחובר') }
    },
    [mode, childAccessToken]
  )

  const addVideo = useCallback(
    async (playlistId: string, payload: PlaylistVideoPayload) => {
      if (mode === 'parent') return addVideoToPlaylist(playlistId, payload)
      if (childAccessToken) return addVideoToPlaylistForChild(childAccessToken, playlistId, payload)
      return { error: new Error('לא מחובר') }
    },
    [mode, childAccessToken]
  )

  const removeVideo = useCallback(
    async (playlistId: string, youtubeVideoId: string) => {
      if (mode === 'parent') return removeVideoFromPlaylist(playlistId, youtubeVideoId)
      if (childAccessToken) {
        return removeVideoFromPlaylistForChild(childAccessToken, playlistId, youtubeVideoId)
      }
      return { error: new Error('לא מחובר') }
    },
    [mode, childAccessToken]
  )

  const getPlaylistIdsForVideo = useCallback(
    async (youtubeVideoId: string) => {
      if (mode === 'parent' && userId) {
        return playlistIdsContainingVideo(userId, youtubeVideoId)
      }
      if (mode === 'kid' && childAccessToken) {
        return playlistIdsContainingVideoForChild(childAccessToken, youtubeVideoId)
      }
      return { data: [], error: null }
    },
    [mode, userId, childAccessToken]
  )

  return {
    playlists,
    loading,
    refresh,
    createPlaylist,
    fetchVideos,
    addVideo,
    removeVideo,
    getPlaylistIdsForVideo,
  }
}
