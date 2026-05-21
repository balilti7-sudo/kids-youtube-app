import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addChildPlaylistVideo,
  listChildPlaylist,
  removeChildPlaylistVideo,
  type ChildPlaylistVideo,
  type PlaylistTogglePayload,
} from '../lib/childPlaylist'

export function useChildPlaylist(accessToken: string | null) {
  const [items, setItems] = useState<ChildPlaylistVideo[]>([])
  const [loading, setLoading] = useState(false)
  const [toggleBusyId, setToggleBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setItems([])
      return
    }
    setLoading(true)
    const { data, error } = await listChildPlaylist(accessToken)
    setLoading(false)
    if (!error) setItems(data)
  }, [accessToken])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const idSet = useMemo(() => new Set(items.map((v) => v.youtube_video_id)), [items])

  const isInPlaylist = useCallback((videoId: string) => idSet.has(videoId), [idSet])

  const toggle = useCallback(
    async (payload: PlaylistTogglePayload) => {
      if (!accessToken) return { error: new Error('אין חיבור מכשיר') }
      setToggleBusyId(payload.youtube_video_id)
      try {
        if (idSet.has(payload.youtube_video_id)) {
          const { error } = await removeChildPlaylistVideo(accessToken, payload.youtube_video_id)
          if (error) return { error }
        } else {
          const { error } = await addChildPlaylistVideo(accessToken, payload)
          if (error) return { error }
        }
        await refresh()
        return { error: null }
      } finally {
        setToggleBusyId(null)
      }
    },
    [accessToken, idSet, refresh]
  )

  return {
    items,
    loading,
    refresh,
    idSet,
    isInPlaylist,
    toggle,
    toggleBusyId,
  }
}
