import { create } from 'zustand'
import type { WhitelistedChannel, WhitelistedVideo, YouTubeChannelResult, YouTubeVideoResult } from '../types'
import { childAllowedChannelToWhitelist, getChildAllowedChannels } from '../lib/childDevice'
import { withMutationTimeout } from '../lib/mutationTimeout'
import { supabase } from '../lib/supabase'

/** Logged-in parent mutations use Supabase auth + RLS. PIN is checked in UI only — never block on verify_parent_pin RPC here (that RPC hung add-channel on slow networks). */
async function requireAuthenticatedParentPin(userId: string): Promise<Error | null> {
  if (!userId.trim()) {
    return new Error('לא מחובר')
  }
  return null
}

function channelFromSearchResult(
  channelId: string,
  yt: YouTubeChannelResult,
  category?: string | null
): WhitelistedChannel {
  const normalizedCategory = category?.trim() ? category.trim() : null
  return {
    id: channelId,
    youtube_channel_id: yt.channelId,
    channel_name: yt.title,
    category: normalizedCategory,
    channel_thumbnail: yt.thumbnail || null,
    subscriber_count: yt.subscriberCount || null,
    description: yt.description || null,
    last_videos_refresh_at: null,
    videos_cache_next_page_token: null,
    videos_cache_uploads_playlist_id: null,
    videos_cache_has_more: false,
    created_at: new Date().toISOString(),
  }
}

function upsertWhitelistChannel(
  set: (partial: Partial<ChannelState>) => void,
  get: () => ChannelState,
  channel: WhitelistedChannel
) {
  const list = get().whitelist
  const idx = list.findIndex(
    (c) => c.id === channel.id || c.youtube_channel_id === channel.youtube_channel_id
  )
  if (idx >= 0) {
    const next = [...list]
    next[idx] = { ...next[idx], ...channel }
    set({ whitelist: next })
    return
  }
  set({ whitelist: [...list, channel] })
}

interface ChannelState {
  whitelist: WhitelistedChannel[]
  approvedVideos: WhitelistedVideo[]
  searchResults: YouTubeChannelResult[]
  videoSearchResults: YouTubeVideoResult[]
  searchLoading: boolean
  videoSearchLoading: boolean
  searchError: string | null
  videoSearchError: string | null
  loading: boolean
  setWhitelist: (channels: WhitelistedChannel[]) => void
  setApprovedVideos: (videos: WhitelistedVideo[]) => void
  fetchWhitelistForDevice: (deviceId: string) => Promise<void>
  fetchApprovedVideosForDevice: (deviceId: string) => Promise<void>
  setSearchResults: (results: YouTubeChannelResult[]) => void
  setVideoSearchResults: (results: YouTubeVideoResult[]) => void
  setSearchLoading: (v: boolean) => void
  setVideoSearchLoading: (v: boolean) => void
  setSearchError: (e: string | null) => void
  setVideoSearchError: (e: string | null) => void
  addChannelToDevice: (params: {
    deviceId: string
    userId: string
    yt: YouTubeChannelResult
    category?: string | null
    /** Required — re-verified server-side via verify_parent_pin before mutation. */
    parentPin: string
  }) => Promise<{ error: Error | null }>
  addVideoToDevice: (params: {
    deviceId: string
    userId: string
    yt: YouTubeVideoResult
    parentPin: string
  }) => Promise<{ error: Error | null }>
  removeChannelFromDevice: (
    deviceId: string,
    channelId: string,
    opts: { userId: string; parentPin: string }
  ) => Promise<{ error: Error | null }>
  removeVideoFromDevice: (
    deviceId: string,
    videoId: string,
    opts: { userId: string; parentPin: string }
  ) => Promise<{ error: Error | null }>
  fetchWhitelistForLocalParent: (accessToken: string) => Promise<void>
  /** Public child RPC — no parent Supabase session required */
  fetchWhitelistFromChildToken: (accessToken: string) => Promise<void>
  addChannelLocalParent: (params: {
    accessToken: string
    pin: string
    yt: import('../types').YouTubeChannelResult
    category?: string | null
  }) => Promise<{ error: Error | null }>
  removeChannelLocalParent: (accessToken: string, pin: string, channelId: string) => Promise<{ error: Error | null }>
  replaceChannelCacheLocalParent: (params: {
    accessToken: string
    pin: string
    channelDbId: string
    videos: {
      youtube_video_id: string
      title: string
      thumbnail_url: string | null
      published_at: string | null
      position: number
      duration_seconds?: number | null
    }[]
    /** ברירת מחדל true: מוחק את כל המטמון לערוץ לפני ההכנסה. false: מוסיף אצווה (אחרי אצווה עם clear). */
    clearExisting?: boolean
    nextPageToken?: string | null
    uploadsPlaylistId?: string | null
    hasMore?: boolean | null
  }) => Promise<{ error: Error | null }>
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  whitelist: [],
  approvedVideos: [],
  searchResults: [],
  videoSearchResults: [],
  searchLoading: false,
  videoSearchLoading: false,
  searchError: null,
  videoSearchError: null,
  loading: false,

  setWhitelist: (whitelist) => set({ whitelist }),
  setApprovedVideos: (approvedVideos) => set({ approvedVideos }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setVideoSearchResults: (videoSearchResults) => set({ videoSearchResults }),
  setSearchLoading: (searchLoading) => set({ searchLoading }),
  setVideoSearchLoading: (videoSearchLoading) => set({ videoSearchLoading }),
  setSearchError: (searchError) => set({ searchError }),
  setVideoSearchError: (videoSearchError) => set({ videoSearchError }),

  fetchWhitelistForDevice: async (deviceId) => {
    // Keep existing list visible during background refresh so search inputs aren't unmounted.
    const showLoading = get().whitelist.length === 0
    if (showLoading) set({ loading: true })
    const { data, error } = await supabase
      .from('device_whitelist')
      .select('*, channel:whitelisted_channels(*)')
      .eq('device_id', deviceId)

    if (error) {
      set({ loading: false, whitelist: showLoading ? [] : get().whitelist })
      return
    }
    const channels = (data ?? [])
      .map((row: { channel: WhitelistedChannel | null }) => row.channel)
      .filter(Boolean) as WhitelistedChannel[]
    set({ whitelist: channels, loading: false })
  },

  fetchApprovedVideosForDevice: async (deviceId) => {
    set({ loading: true })
    const { data, error } = await supabase
      .from('device_video_whitelist')
      .select('*, video:whitelisted_videos(*)')
      .eq('device_id', deviceId)
      .order('added_at', { ascending: false })

    if (error) {
      set({ loading: false, approvedVideos: [] })
      return
    }

    const videos = (data ?? [])
      .map((row: { video: WhitelistedVideo | null }) => row.video)
      .filter(Boolean) as WhitelistedVideo[]
    set({ approvedVideos: videos, loading: false })
  },

  addChannelToDevice: async ({ deviceId, userId, yt, category }) => {
    const pinErr = await requireAuthenticatedParentPin(userId)
    if (pinErr) return { error: pinErr }

    const normalizedCategory = category?.trim() ? category.trim() : null

    // Optimistic — channel appears in the list immediately while the network runs.
    const optimisticId = `opt-${yt.channelId}`
    upsertWhitelistChannel(set, get, channelFromSearchResult(optimisticId, yt, category))

    try {
      const { data, error } = await withMutationTimeout(
        supabase.rpc('parent_add_channel_to_device', {
          p_device_id: deviceId,
          p_youtube_channel_id: yt.channelId,
          p_channel_name: yt.title,
          p_channel_thumbnail: yt.thumbnail ?? '',
          p_subscriber_count: yt.subscriberCount ?? '',
          p_description: yt.description ?? '',
          p_category: normalizedCategory ?? '',
        }),
        8_000
      )

      if (!error && data && typeof data === 'object') {
        const row = data as { ok?: boolean; error?: string; channel_id?: string }
        if (row.ok && row.channel_id) {
          const list = get().whitelist.filter(
            (c) => c.id !== optimisticId && c.youtube_channel_id !== yt.channelId
          )
          set({
            whitelist: [...list, channelFromSearchResult(row.channel_id, yt, category)],
          })
          return { error: null }
        }
        if (row.error === 'device_not_found') {
          throw new Error('המכשיר לא נמצא')
        }
        if (row.error === 'not_authenticated') {
          throw new Error('יש להתחבר מחדש')
        }
      }

      const rpcMissing =
        error &&
        /parent_add_channel_to_device|could not find|does not exist|42883/i.test(error.message || '')

      if (!rpcMissing) {
        throw new Error(error?.message || 'שגיאה בהוספת ערוץ')
      }

      // Fallback when migration 076 is not applied yet — legacy 3-step path.
      let channelId: string
      const existing = await withMutationTimeout(
        supabase
          .from('whitelisted_channels')
          .select('id, category')
          .eq('youtube_channel_id', yt.channelId)
          .maybeSingle()
      )

      if (existing.data?.id) {
        channelId = existing.data.id
        if (normalizedCategory && existing.data.category !== normalizedCategory) {
          const { error: updateError } = await withMutationTimeout(
            supabase.from('whitelisted_channels').update({ category: normalizedCategory }).eq('id', channelId)
          )
          if (updateError) throw new Error(updateError.message)
        }
      } else {
        const ins = await withMutationTimeout(
          supabase
            .from('whitelisted_channels')
            .insert({
              youtube_channel_id: yt.channelId,
              channel_name: yt.title,
              category: normalizedCategory,
              channel_thumbnail: yt.thumbnail || null,
              subscriber_count: yt.subscriberCount || null,
              description: yt.description || null,
            })
            .select('id')
            .single()
        )
        if (ins.error) throw new Error(ins.error.message)
        channelId = ins.data.id
      }

      const link = await withMutationTimeout(
        supabase.from('device_whitelist').insert({
          device_id: deviceId,
          channel_id: channelId,
          added_by: userId,
        })
      )
      if (link.error && link.error.code !== '23505') {
        throw new Error(link.error.message)
      }

      const list = get().whitelist.filter(
        (c) => c.id !== optimisticId && c.youtube_channel_id !== yt.channelId
      )
      set({ whitelist: [...list, channelFromSearchResult(channelId, yt, category)] })
      return { error: null }
    } catch (e) {
      set({
        whitelist: get().whitelist.filter(
          (c) => c.id !== optimisticId && c.youtube_channel_id !== yt.channelId
        ),
      })
      return { error: e instanceof Error ? e : new Error('שגיאה בהוספת ערוץ') }
    }
  },

  removeChannelFromDevice: async (deviceId, channelId, { userId }) => {
    const pinErr = await requireAuthenticatedParentPin(userId)
    if (pinErr) return { error: pinErr }

    const prev = get().whitelist
    set({ whitelist: prev.filter((c) => c.id !== channelId) })

    try {
      const { data, error } = await withMutationTimeout(
        supabase.rpc('parent_remove_channel_from_device', {
          p_device_id: deviceId,
          p_channel_id: channelId,
        })
      )

      if (!error && data && typeof data === 'object') {
        const row = data as { ok?: boolean; error?: string }
        if (row.ok) return { error: null }
        if (row.error === 'device_not_found') throw new Error('המכשיר לא נמצא')
        if (row.error === 'not_linked') throw new Error('הערוץ לא מקושר לפרופיל')
        if (row.error === 'not_authenticated') throw new Error('יש להתחבר מחדש')
      }

      const rpcMissing =
        error &&
        /parent_remove_channel_from_device|could not find|does not exist|42883/i.test(error.message || '')

      if (!rpcMissing) {
        throw new Error(error?.message || 'שגיאה בהסרת ערוץ')
      }

      const { error: deleteError } = await withMutationTimeout(
        supabase.from('device_whitelist').delete().eq('device_id', deviceId).eq('channel_id', channelId)
      )
      if (deleteError) throw new Error(deleteError.message)
      return { error: null }
    } catch (e) {
      set({ whitelist: prev })
      return { error: e instanceof Error ? e : new Error('שגיאה בהסרת ערוץ') }
    }
  },

  addVideoToDevice: async ({ deviceId, userId, yt }) => {
    const pinErr = await requireAuthenticatedParentPin(userId)
    if (pinErr) return { error: pinErr }
    const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/
    if (!videoIdPattern.test(yt.videoId)) {
      return { error: new Error('INVALID_VIDEO_ID') }
    }

    const { error: rpcError } = await supabase.rpc('parent_approve_video_for_device', {
      p_device_id: deviceId,
      p_youtube_video_id: yt.videoId,
      p_title: yt.title?.slice(0, 500) ?? yt.videoId,
      p_thumbnail_url: yt.thumbnail || null,
      p_youtube_channel_id: null,
    })

    if (rpcError) {
      return { error: new Error(rpcError.message) }
    }

    await get().fetchApprovedVideosForDevice(deviceId)
    return { error: null }
  },

  removeVideoFromDevice: async (deviceId, videoId, { userId }) => {
    const pinErr = await requireAuthenticatedParentPin(userId)
    if (pinErr) return { error: pinErr }
    const { error } = await supabase
      .from('device_video_whitelist')
      .delete()
      .eq('device_id', deviceId)
      .eq('video_id', videoId)
    if (error) return { error: new Error(error.message) }
    set({ approvedVideos: get().approvedVideos.filter((v) => v.id !== videoId) })
    return { error: null }
  },

  fetchWhitelistFromChildToken: async (accessToken) => {
    set({ loading: true })
    try {
      const { data, error } = await getChildAllowedChannels(accessToken)
      if (error) {
        set({ loading: false, whitelist: [] })
        return
      }
      set({
        whitelist: data.map(childAllowedChannelToWhitelist),
        loading: false,
      })
    } catch {
      set({ loading: false, whitelist: [] })
    }
  },

  fetchWhitelistForLocalParent: async (accessToken) => {
    const showLoading = get().whitelist.length === 0
    if (showLoading) set({ loading: true })
    const { data, error } = await supabase.rpc('local_parent_whitelist_for_device', {
      p_access_token: accessToken,
    })
    if (error) {
      set({ loading: false, whitelist: showLoading ? [] : get().whitelist })
      return
    }
    const raw = data as unknown
    const arr = Array.isArray(raw) ? raw : []
    if (!Array.isArray(arr)) {
      set({ loading: false, whitelist: showLoading ? [] : get().whitelist })
      return
    }
    const channels = arr as WhitelistedChannel[]
    set({ whitelist: channels, loading: false })
  },

  addChannelLocalParent: async ({ accessToken, pin, yt, category }) => {
    const normalizedCategory = category?.trim() ? category.trim() : null
    const optimisticId = `opt-${yt.channelId}`
    upsertWhitelistChannel(set, get, channelFromSearchResult(optimisticId, yt, category))

    try {
      const { data, error } = await withMutationTimeout(
        supabase.rpc('local_parent_add_channel', {
          p_access_token: accessToken,
          p_pin: pin,
          p_youtube_channel_id: yt.channelId,
          p_channel_name: yt.title,
          p_channel_thumbnail: yt.thumbnail ?? '',
          p_subscriber_count: yt.subscriberCount ?? '',
          p_description: yt.description ?? '',
          p_category: normalizedCategory ?? '',
        }),
        8_000
      )
      if (error) throw new Error(error.message)
      const row = data as { ok?: boolean; error?: string; channel_id?: string } | null
      if (!row?.ok) {
        const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה בהוספת ערוץ'
        throw new Error(msg)
      }
      if (row.channel_id) {
        const list = get().whitelist.filter(
          (c) => c.id !== optimisticId && c.youtube_channel_id !== yt.channelId
        )
        set({ whitelist: [...list, channelFromSearchResult(row.channel_id, yt, category)] })
      }
      return { error: null }
    } catch (e) {
      set({
        whitelist: get().whitelist.filter(
          (c) => c.id !== optimisticId && c.youtube_channel_id !== yt.channelId
        ),
      })
      return { error: e instanceof Error ? e : new Error('שגיאה בהוספת ערוץ') }
    }
  },

  removeChannelLocalParent: async (accessToken, pin, channelId) => {
    const prev = get().whitelist
    set({ whitelist: prev.filter((c) => c.id !== channelId) })

    try {
      const { data, error } = await withMutationTimeout(
        supabase.rpc('local_parent_remove_channel', {
          p_access_token: accessToken,
          p_pin: pin,
          p_channel_id: channelId,
        })
      )
      if (error) throw new Error(error.message)
      const row = data as { ok?: boolean; error?: string } | null
      if (!row?.ok) {
        const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה בהסרה'
        throw new Error(msg)
      }
      return { error: null }
    } catch (e) {
      set({ whitelist: prev })
      return { error: e instanceof Error ? e : new Error('שגיאה בהסרה') }
    }
  },

  replaceChannelCacheLocalParent: async ({
    accessToken,
    pin,
    channelDbId,
    videos,
    clearExisting = true,
    nextPageToken = null,
    uploadsPlaylistId = null,
    hasMore = null,
  }) => {
    const { data, error } = await supabase.rpc('local_parent_replace_channel_videos_cache', {
      p_access_token: accessToken,
      p_pin: pin,
      p_channel_id: channelDbId,
      p_videos: videos,
      p_clear_existing: clearExisting,
      p_next_page_token: nextPageToken,
      p_uploads_playlist_id: uploadsPlaylistId,
      p_has_more: hasMore,
    })
    if (error) return { error: new Error(error.message) }
    const row = data as { ok?: boolean; error?: string } | null
    if (!row?.ok) {
      const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה ברענון מטמון'
      return { error: new Error(msg) }
    }
    if (hasMore != null || nextPageToken !== undefined || uploadsPlaylistId !== undefined) {
      const list = get().whitelist
      const idx = list.findIndex((c) => c.id === channelDbId)
      if (idx >= 0) {
        const next = [...list]
        next[idx] = {
          ...next[idx],
          videos_cache_has_more: hasMore ?? next[idx].videos_cache_has_more,
          videos_cache_next_page_token:
            nextPageToken === undefined ? next[idx].videos_cache_next_page_token : nextPageToken,
          videos_cache_uploads_playlist_id:
            uploadsPlaylistId === undefined
              ? next[idx].videos_cache_uploads_playlist_id
              : uploadsPlaylistId,
          last_videos_refresh_at: new Date().toISOString(),
        }
        set({ whitelist: next })
      }
    }
    return { error: null }
  },
}))
