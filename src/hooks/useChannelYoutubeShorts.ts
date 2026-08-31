import { useEffect, useRef, useState } from 'react'
import { fetchChannelShortsPage, type ChannelVideoItem } from '../lib/youtube'
import {
  buildYoutubeShortsUrl,
  toWatchableVideo,
  type WatchableVideoBase,
} from '../lib/videoFormatClassification'

function toShortsWatchable(row: ChannelVideoItem): WatchableVideoBase {
  return toWatchableVideo({
    youtube_video_id: row.videoId,
    title: row.title,
    thumbnail_url: row.thumbnail || null,
    durationSeconds: row.durationSeconds ?? null,
    publishedAt: row.publishedAt ?? null,
    watchUrl: buildYoutubeShortsUrl(row.videoId),
  })
}

/** Load the channel’s YouTube Shorts playlist (UUSH) when the Shorts tab is open. */
export function useChannelYoutubeShorts(youtubeChannelId: string | null | undefined, enabled: boolean) {
  const [videos, setVideos] = useState<WatchableVideoBase[]>([])
  const [items, setItems] = useState<ChannelVideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const genRef = useRef(0)

  useEffect(() => {
    if (!enabled || !youtubeChannelId?.trim()) {
      setVideos([])
      setItems([])
      setLoading(false)
      setError(null)
      return
    }

    const gen = ++genRef.current
    setLoading(true)
    setError(null)

    void fetchChannelShortsPage(youtubeChannelId, { maxPages: 2 }).then((result) => {
      if (gen !== genRef.current) return
      setLoading(false)
      if (result.error) {
        setVideos([])
        setItems([])
        setError(result.error.message)
        return
      }
      const rows = result.data?.videos ?? []
      setItems(rows)
      setVideos(rows.map(toShortsWatchable))
    })
  }, [enabled, youtubeChannelId])

  return { videos, items, loading, error }
}
