import { useCallback, useMemo, useState } from 'react'
import type { PlaylistVideoPayload } from '../lib/playlists'

export type VideoSelectionMap = Map<string, PlaylistVideoPayload>

export function useVideoMultiSelect() {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<VideoSelectionMap>(() => new Map())

  const selectedCount = selected.size
  const selectedVideos = useMemo(() => [...selected.values()], [selected])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const toggle = useCallback((video: PlaylistVideoPayload) => {
    const id = video.youtube_video_id
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, video)
      return next
    })
  }, [])

  const selectMany = useCallback((videos: PlaylistVideoPayload[]) => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const video of videos) {
        if (video.youtube_video_id) next.set(video.youtube_video_id, video)
      }
      return next
    })
  }, [])

  const clear = useCallback(() => setSelected(new Map()), [])

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelected(new Map())
  }, [])

  return useMemo(
    () => ({
      selectionMode,
      selectedCount,
      selectedVideos,
      isSelected,
      toggle,
      selectMany,
      clear,
      enterSelectionMode,
      exitSelectionMode,
      setSelectionMode,
    }),
    [
      selectionMode,
      selectedCount,
      selectedVideos,
      isSelected,
      toggle,
      selectMany,
      clear,
      enterSelectionMode,
      exitSelectionMode,
    ]
  )
}
