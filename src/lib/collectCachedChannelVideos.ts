import { supabase } from './supabase'
import { getChildCachedChannelVideos } from './childDevice'
import { listHiddenVideoIdsForDevice, listHiddenVideoIdsLocalParent } from './hiddenVideos'
import type { PlaylistVideoPayload } from './playlists'
import type { WhitelistedChannel } from '../types'

export type CollectCachedVideosResult = {
  videos: PlaylistVideoPayload[]
  error: Error | null
  channelCount: number
  skippedEmptyChannels: number
}

function dedupeVideos(list: PlaylistVideoPayload[]): PlaylistVideoPayload[] {
  const map = new Map<string, PlaylistVideoPayload>()
  for (const v of list) {
    const id = v.youtube_video_id?.trim()
    if (!id) continue
    map.set(id, { ...v, youtube_video_id: id })
  }
  return [...map.values()]
}

/** Parent (auth) or local-parent: load cached videos for many whitelist channels. */
export async function collectCachedVideosForParentChannels(opts: {
  channels: WhitelistedChannel[]
  deviceId?: string | null
  localAccessToken?: string | null
  localPin?: string | null
}): Promise<CollectCachedVideosResult> {
  const channels = opts.channels.filter((c) => c.youtube_channel_id?.trim())
  if (channels.length === 0) {
    return { videos: [], error: null, channelCount: 0, skippedEmptyChannels: 0 }
  }

  let hidden = new Set<string>()
  try {
    if (opts.localAccessToken) {
      const hid = await listHiddenVideoIdsLocalParent(opts.localAccessToken, opts.localPin ?? '')
      hidden = hid.data
    } else if (opts.deviceId) {
      const hid = await listHiddenVideoIdsForDevice(opts.deviceId)
      hidden = hid.data
    }
  } catch {
    /* keep empty hidden set */
  }

  const collected: PlaylistVideoPayload[] = []
  let skippedEmptyChannels = 0

  for (const channel of channels) {
    try {
      let rows: { videoId: string; title: string; thumbnail: string | null }[] = []

      if (opts.localAccessToken) {
        const { data, error } = await supabase.rpc('local_parent_list_channel_videos', {
          p_access_token: opts.localAccessToken,
          p_pin: opts.localPin ?? '',
          p_youtube_channel_id: channel.youtube_channel_id,
        })
        if (error) throw new Error(error.message)
        rows = ((data ?? []) as Record<string, unknown>[]).map((v) => {
          const row = v as { youtube_video_id: string; title: string; thumbnail_url: string | null }
          return {
            videoId: row.youtube_video_id,
            title: row.title,
            thumbnail: row.thumbnail_url,
          }
        })
      } else {
        const { data, error } = await supabase
          .from('channel_videos_cache')
          .select('youtube_video_id, title, thumbnail_url, position')
          .eq('channel_id', channel.id)
          .order('position', { ascending: true })
        if (error) throw new Error(error.message)
        rows = (data ?? []).map((r) => {
          const row = r as { youtube_video_id: string; title: string; thumbnail_url: string | null }
          return {
            videoId: row.youtube_video_id,
            title: row.title,
            thumbnail: row.thumbnail_url,
          }
        })
      }

      const visible = rows.filter((r) => r.videoId && !hidden.has(r.videoId))
      if (visible.length === 0) {
        skippedEmptyChannels += 1
        continue
      }

      for (const r of visible) {
        collected.push({
          youtube_video_id: r.videoId,
          title: r.title || r.videoId,
          thumbnail_url: r.thumbnail,
          youtube_channel_id: channel.youtube_channel_id,
          channel_name: channel.channel_name,
        })
      }
    } catch (e) {
      return {
        videos: dedupeVideos(collected),
        error: e instanceof Error ? e : new Error('טעינת סרטוני ערוץ נכשלה'),
        channelCount: channels.length,
        skippedEmptyChannels,
      }
    }
  }

  return {
    videos: dedupeVideos(collected),
    error: null,
    channelCount: channels.length,
    skippedEmptyChannels,
  }
}

/** Kid device token: load cached videos for many allowed channels. */
export async function collectCachedVideosForChildChannels(opts: {
  accessToken: string
  channels: Array<{
    youtube_channel_id: string
    channel_name: string
  }>
}): Promise<CollectCachedVideosResult> {
  const channels = opts.channels.filter((c) => c.youtube_channel_id?.trim())
  if (channels.length === 0) {
    return { videos: [], error: null, channelCount: 0, skippedEmptyChannels: 0 }
  }

  const collected: PlaylistVideoPayload[] = []
  let skippedEmptyChannels = 0

  for (const channel of channels) {
    const { data, error } = await getChildCachedChannelVideos(opts.accessToken, channel.youtube_channel_id)
    if (error) {
      return {
        videos: dedupeVideos(collected),
        error,
        channelCount: channels.length,
        skippedEmptyChannels,
      }
    }
    const rows = data ?? []
    if (rows.length === 0) {
      skippedEmptyChannels += 1
      continue
    }
    for (const v of rows) {
      const id = v.youtube_video_id?.trim()
      if (!id) continue
      collected.push({
        youtube_video_id: id,
        title: v.title?.trim() || id,
        thumbnail_url: v.thumbnail_url ?? null,
        youtube_channel_id: channel.youtube_channel_id,
        channel_name: channel.channel_name,
      })
    }
  }

  return {
    videos: dedupeVideos(collected),
    error: null,
    channelCount: channels.length,
    skippedEmptyChannels,
  }
}
