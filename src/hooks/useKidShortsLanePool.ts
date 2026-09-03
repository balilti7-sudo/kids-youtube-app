import { useEffect, useMemo, useState } from 'react'
import { SHORTS_LANE_CROSS_CHANNEL } from '../config/shortsLane'
import { collectCachedVideosForChildChannels } from '../lib/collectCachedChannelVideos'
import type { ChildAllowedChannel } from '../lib/childDevice'
import type { ChannelContentTag } from '../lib/contentTags/types'
import { shouldHideFromChildBrowse } from '../lib/liveStreamPolicy'
import {
  buildChannelTagMap,
  buildShortsLaneItem,
  type ShortsLaneItem,
} from '../lib/shortsFeedRank'
import { belongsOnShortsShelf, buildYoutubeWatchUrl } from '../lib/videoFormatClassification'

type ChannelVideoRow = {
  videoId: string
  title: string
  thumbnail: string
  durationSeconds?: number | null
  publishedAt?: string | null
  liveBroadcastContent?: 'none' | 'live' | 'upcoming' | null
  fromShortsPlaylist?: boolean
}

function videoLooksLikeShort(
  input: {
    videoId: string
    title: string
    thumbnail?: string | null
    durationSeconds?: number | null
    fromShortsPlaylist?: boolean
  },
  portraitThumbnailIds?: ReadonlySet<string>
): boolean {
  if (input.fromShortsPlaylist) return true
  return belongsOnShortsShelf(
    {
      title: input.title,
      durationSeconds: input.durationSeconds ?? null,
      youtubeVideoId: input.videoId,
      thumbnail_url: input.thumbnail ?? null,
      watchUrl: input.fromShortsPlaylist
        ? `https://www.youtube.com/shorts/${encodeURIComponent(input.videoId)}`
        : buildYoutubeWatchUrl(input.videoId),
    },
    portraitThumbnailIds
  )
}

function mergeShortsPool(
  cached: ShortsLaneItem[],
  channelVideos: ChannelVideoRow[],
  activeChannel: ChildAllowedChannel | null,
  tagMap: Map<string, ChannelContentTag[]>,
  portraitThumbnailIds?: ReadonlySet<string>
): ShortsLaneItem[] {
  const byId = new Map<string, ShortsLaneItem>()
  for (const item of cached) {
    byId.set(item.videoId, item)
  }

  if (activeChannel) {
    for (const video of channelVideos) {
      if (shouldHideFromChildBrowse(video.title, video.liveBroadcastContent ?? 'none')) continue
      if (
        !videoLooksLikeShort(
          {
            videoId: video.videoId,
            title: video.title,
            thumbnail: video.thumbnail,
            durationSeconds: video.durationSeconds,
            fromShortsPlaylist: video.fromShortsPlaylist,
          },
          portraitThumbnailIds
        )
      )
        continue
      byId.set(
        video.videoId,
        buildShortsLaneItem({
          videoId: video.videoId,
          title: video.title,
          thumbnail: video.thumbnail || null,
          youtubeChannelId: activeChannel.youtube_channel_id,
          channelName: activeChannel.channel_name,
          channelThumbnail: activeChannel.channel_thumbnail,
          channelTags: tagMap.get(activeChannel.youtube_channel_id) ?? [],
          durationSeconds: video.durationSeconds ?? null,
          publishedAt: video.publishedAt ?? null,
        })
      )
    }
  }

  return [...byId.values()]
}

export function useKidShortsLanePool(
  accessToken: string | null,
  channels: ChildAllowedChannel[],
  channelVideos: ChannelVideoRow[],
  activeChannel: ChildAllowedChannel | null,
  /** Load cross-channel cache only when Shorts Lane is open — avoids heavy RPC on kid boot. */
  enabled: boolean,
  portraitThumbnailIds?: ReadonlySet<string>
) {
  const [cachedPool, setCachedPool] = useState<ShortsLaneItem[]>([])
  const [loading, setLoading] = useState(false)

  const tagMap = useMemo(() => buildChannelTagMap(channels), [channels])
  const channelKey = useMemo(
    () => channels.map((c) => c.youtube_channel_id).join('\0'),
    [channels]
  )

  useEffect(() => {
    if (!enabled || !accessToken || !SHORTS_LANE_CROSS_CHANNEL || channels.length === 0) {
      if (!enabled) {
        setCachedPool([])
        setLoading(false)
      }
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      const { videos, error } = await collectCachedVideosForChildChannels({
        accessToken,
        channels: channels.map((c) => ({
          youtube_channel_id: c.youtube_channel_id,
          channel_name: c.channel_name,
        })),
      })

      if (cancelled) return

      if (error) {
        setCachedPool([])
        setLoading(false)
        return
      }

      const channelByYt = new Map(channels.map((c) => [c.youtube_channel_id, c]))
      const shorts: ShortsLaneItem[] = []

      for (const video of videos) {
        const id = video.youtube_video_id?.trim()
        if (!id) continue
        if (shouldHideFromChildBrowse(video.title, 'none')) continue
        if (
          !videoLooksLikeShort(
            {
              videoId: id,
              title: video.title,
              thumbnail: video.thumbnail_url,
            },
            portraitThumbnailIds
          )
        ) {
          continue
        }

        const ytChannelId = video.youtube_channel_id ?? ''
        const ch = channelByYt.get(ytChannelId)
        if (!ch) continue

        shorts.push(
          buildShortsLaneItem({
            videoId: id,
            title: video.title,
            thumbnail: video.thumbnail_url,
            youtubeChannelId: ch.youtube_channel_id,
            channelName: ch.channel_name,
            channelThumbnail: ch.channel_thumbnail,
            channelTags: tagMap.get(ch.youtube_channel_id) ?? [],
          })
        )
      }

      setCachedPool(shorts)
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [accessToken, enabled, channelKey, channels, tagMap, portraitThumbnailIds])

  const pool = useMemo(
    () => mergeShortsPool(cachedPool, channelVideos, activeChannel, tagMap, portraitThumbnailIds),
    [cachedPool, channelVideos, activeChannel, tagMap, portraitThumbnailIds]
  )

  return { pool, loading }
}
