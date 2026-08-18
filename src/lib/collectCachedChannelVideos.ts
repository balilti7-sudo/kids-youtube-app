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

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!, i)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
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
  let firstError: Error | null = null

  const results = await mapPool(channels, 6, async (channel) => {
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
      return { videos: visible, channel, empty: visible.length === 0, error: null as Error | null }
    } catch (e) {
      return {
        videos: [] as { videoId: string; title: string; thumbnail: string | null }[],
        channel,
        empty: true,
        error: e instanceof Error ? e : new Error('טעינת סרטוני ערוץ נכשלה'),
      }
    }
  })

  for (const result of results) {
    if (result.error && !firstError) firstError = result.error
    if (result.empty) {
      skippedEmptyChannels += 1
      continue
    }
    for (const r of result.videos) {
      collected.push({
        youtube_video_id: r.videoId,
        title: r.title || r.videoId,
        thumbnail_url: r.thumbnail,
        youtube_channel_id: result.channel.youtube_channel_id,
        channel_name: result.channel.channel_name,
      })
    }
  }

  if (collected.length === 0 && firstError) {
    return {
      videos: [],
      error: firstError,
      channelCount: channels.length,
      skippedEmptyChannels,
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
  let firstError: Error | null = null

  const results = await mapPool(channels, 6, async (channel) => {
    const { data, error } = await getChildCachedChannelVideos(opts.accessToken, channel.youtube_channel_id)
    if (error) return { channel, rows: [] as NonNullable<typeof data>, error }
    return { channel, rows: data ?? [], error: null as Error | null }
  })

  for (const result of results) {
    if (result.error) {
      if (!firstError) firstError = result.error
      skippedEmptyChannels += 1
      continue
    }
    if (result.rows.length === 0) {
      skippedEmptyChannels += 1
      continue
    }
    for (const v of result.rows) {
      const id = v.youtube_video_id?.trim()
      if (!id) continue
      collected.push({
        youtube_video_id: id,
        title: v.title?.trim() || id,
        thumbnail_url: v.thumbnail_url ?? null,
        youtube_channel_id: result.channel.youtube_channel_id,
        channel_name: result.channel.channel_name,
      })
    }
  }

  if (collected.length === 0 && firstError) {
    return {
      videos: [],
      error: firstError,
      channelCount: channels.length,
      skippedEmptyChannels,
    }
  }

  return {
    videos: dedupeVideos(collected),
    error: null,
    channelCount: channels.length,
    skippedEmptyChannels,
  }
}
