import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { PlaylistVideo } from '../lib/playlists'
import { movePlaylistVideo, playlistVideoIds } from '../lib/playlistVideoOrder'

export function usePlaylistQueueHandlers(opts: {
  playlistId: string | null
  videos: PlaylistVideo[]
  setVideos: React.Dispatch<React.SetStateAction<PlaylistVideo[]>>
  activeVideoId: string | null
  setActiveVideoId: React.Dispatch<React.SetStateAction<string | null>>
  removeVideo: (playlistId: string, youtubeVideoId: string) => Promise<{ error: Error | null }>
  reorderVideos: (playlistId: string, orderedIds: string[]) => Promise<{ error: Error | null }>
  onRefresh?: () => void
  reloadVideos?: (playlistId: string) => void
}) {
  const {
    playlistId,
    videos,
    setVideos,
    activeVideoId,
    setActiveVideoId,
    removeVideo,
    reorderVideos,
    onRefresh,
    reloadVideos,
  } = opts

  const [reordering, setReordering] = useState(false)

  const handleRemove = useCallback(
    async (youtubeVideoId: string) => {
      if (!playlistId) return
      const prev = videos
      const idx = prev.findIndex((v) => v.youtube_video_id === youtubeVideoId)
      const nextVideos = prev.filter((v) => v.youtube_video_id !== youtubeVideoId)
      const prevActive = activeVideoId

      setVideos(nextVideos)
      if (activeVideoId === youtubeVideoId) {
        setActiveVideoId(
          nextVideos[idx]?.youtube_video_id ?? nextVideos[idx - 1]?.youtube_video_id ?? null
        )
      }

      const { error } = await removeVideo(playlistId, youtubeVideoId)
      if (error) {
        setVideos(prev)
        setActiveVideoId(prevActive)
        toast.error(error.message)
        return
      }
      toast.success('הוסר מהפלייליסט')
      onRefresh?.()
    },
    [playlistId, videos, activeVideoId, setVideos, setActiveVideoId, removeVideo, onRefresh]
  )

  const persistReorder = useCallback(
    async (nextVideos: PlaylistVideo[]) => {
      if (!playlistId) return
      const prev = videos
      setVideos(nextVideos)
      setReordering(true)
      const { error } = await reorderVideos(playlistId, playlistVideoIds(nextVideos))
      setReordering(false)
      if (error) {
        setVideos(prev)
        toast.error(error.message)
        reloadVideos?.(playlistId)
      }
    },
    [playlistId, videos, setVideos, reorderVideos, reloadVideos]
  )

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return
      void persistReorder(movePlaylistVideo(videos, index, index - 1))
    },
    [videos, persistReorder]
  )

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= videos.length - 1) return
      void persistReorder(movePlaylistVideo(videos, index, index + 1))
    },
    [videos, persistReorder]
  )

  return {
    handleRemove,
    handleMoveUp,
    handleMoveDown,
    reordering,
  }
}
