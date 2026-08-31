import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlaylistVideoPayload, UserPlaylist } from '../lib/playlists'
import {
  addVideoToPlaylistViaRpc,
  addVideoToPlaylistForChild,
  createPlaylistForChild,
  createPlaylistForUser,
  listPlaylistVideos,
  listPlaylistVideosForChild,
  listPlaylistsForChild,
  listPlaylistsForUser,
  peekStaleCachedPlaylists,
  playlistIdsContainingVideo,
  playlistIdsContainingVideoForChild,
  removeVideoFromPlaylist,
  removeVideoFromPlaylistForChild,
  reorderPlaylistVideos,
  reorderPlaylistVideosForChild,
} from '../lib/playlists'
import {
  PLAYLIST_VIDEO_ADDED_EVENT,
  type PlaylistVideoAddedDetail,
} from '../lib/playlistEvents'

export type PlaylistMode = 'parent' | 'kid'

export function usePlaylists(opts: {
  mode: PlaylistMode
  userId: string | null
  childAccessToken: string | null
}) {
  const { mode, userId, childAccessToken } = opts
  const cacheKeyId = mode === 'parent' ? userId : childAccessToken
  const [playlists, setPlaylists] = useState<UserPlaylist[]>(() => {
    if (!cacheKeyId) return []
    return peekStaleCachedPlaylists(mode, cacheKeyId) ?? []
  })
  const [loading, setLoading] = useState(() => {
    if (!cacheKeyId) return false
    return (peekStaleCachedPlaylists(mode, cacheKeyId)?.length ?? 0) === 0
  })
  const playlistsRef = useRef(playlists)
  playlistsRef.current = playlists

  const canLoad =
    mode === 'parent' ? Boolean(userId) : Boolean(childAccessToken)

  const refresh = useCallback(async () => {
    if (!canLoad || !cacheKeyId) return

    const stale = peekStaleCachedPlaylists(mode, cacheKeyId)
    if (stale && stale.length > 0) {
      setPlaylists(stale)
      setLoading(false)
    } else if (playlistsRef.current.length === 0) {
      setLoading(true)
    }

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
      if (playlistsRef.current.length === 0) setPlaylists([])
    } finally {
      setLoading(false)
    }
  }, [canLoad, cacheKeyId, mode, userId, childAccessToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onAdded = (event: Event) => {
      const detail = (event as CustomEvent<PlaylistVideoAddedDetail>).detail
      if (!detail?.playlistIds?.length) return
      const ids = new Set(detail.playlistIds)
      setPlaylists((prev) =>
        prev.map((pl) =>
          ids.has(pl.id) ? { ...pl, video_count: pl.video_count + 1, updated_at: new Date().toISOString() } : pl
        )
      )
    }
    window.addEventListener(PLAYLIST_VIDEO_ADDED_EVENT, onAdded)
    return () => window.removeEventListener(PLAYLIST_VIDEO_ADDED_EVENT, onAdded)
  }, [])

  const createPlaylist = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return { data: null, error: new Error('נא להזין שם לפלייליסט') }

      if (mode === 'parent' && userId) {
        const res = await createPlaylistForUser(userId, trimmed)
        if (res.data) {
          setPlaylists((prev) => [res.data!, ...prev.filter((p) => p.id !== res.data!.id)])
        }
        return res
      }
      if (mode === 'kid' && childAccessToken) {
        const { data: id, error } = await createPlaylistForChild(childAccessToken, trimmed)
        if (error) return { data: null, error }
        if (!id) return { data: null, error: new Error('יצירת הפלייליסט נכשלה') }
        const created: UserPlaylist = {
          id,
          name: trimmed,
          video_count: 0,
          updated_at: new Date().toISOString(),
        }
        setPlaylists((prev) => [created, ...prev.filter((p) => p.id !== id)])
        return { data: created, error: null }
      }
      return { data: null, error: new Error('לא מחובר') }
    },
    [mode, userId, childAccessToken]
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
      if (mode === 'parent') return addVideoToPlaylistViaRpc(playlistId, payload)
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

  const reorderVideos = useCallback(
    async (playlistId: string, orderedYoutubeVideoIds: string[]) => {
      if (mode === 'parent') return reorderPlaylistVideos(playlistId, orderedYoutubeVideoIds)
      if (childAccessToken) {
        return reorderPlaylistVideosForChild(childAccessToken, playlistId, orderedYoutubeVideoIds)
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

  return useMemo(
    () => ({
      playlists,
      loading,
      refresh,
      createPlaylist,
      fetchVideos,
      addVideo,
      removeVideo,
      reorderVideos,
      getPlaylistIdsForVideo,
    }),
    [
      playlists,
      loading,
      refresh,
      createPlaylist,
      fetchVideos,
      addVideo,
      removeVideo,
      reorderVideos,
      getPlaylistIdsForVideo,
    ]
  )
}

export type PlaylistsClient = ReturnType<typeof usePlaylists>
