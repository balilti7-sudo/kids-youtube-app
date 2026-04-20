import { create } from 'zustand'
import type { WhitelistedChannel, WhitelistedVideo, YouTubeChannelResult, YouTubeVideoResult } from '../types'
import { supabase } from '../lib/supabase'

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
  }) => Promise<{ error: Error | null }>
  addVideoToDevice: (params: {
    deviceId: string
    userId: string
    yt: YouTubeVideoResult
  }) => Promise<{ error: Error | null }>
  removeChannelFromDevice: (deviceId: string, channelId: string) => Promise<{ error: Error | null }>
  removeVideoFromDevice: (deviceId: string, videoId: string) => Promise<{ error: Error | null }>
  fetchWhitelistForLocalParent: (accessToken: string) => Promise<void>
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
    videos: { youtube_video_id: string; title: string; thumbnail_url: string | null; published_at: string | null; position: number }[]
    /** ברירת מחדל true: מוחק את כל המטמון לערוץ לפני ההכנסה. false: מוסיף אצווה (אחרי אצווה עם clear). */
    clearExisting?: boolean
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
    set({ loading: true })
    const { data, error } = await supabase
      .from('device_whitelist')
      .select('*, channel:whitelisted_channels(*)')
      .eq('device_id', deviceId)

    if (error) {
      set({ loading: false, whitelist: [] })
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
    let channelId: string
    const normalizedCategory = category?.trim() ? category.trim() : null
    const existing = await supabase
      .from('whitelisted_channels')
      .select('id, category')
      .eq('youtube_channel_id', yt.channelId)
      .maybeSingle()

    if (existing.data?.id) {
      channelId = existing.data.id
      if (normalizedCategory && existing.data.category !== normalizedCategory) {
        const { error: updateError } = await supabase
          .from('whitelisted_channels')
          .update({ category: normalizedCategory })
          .eq('id', channelId)
        if (updateError) return { error: new Error(updateError.message) }
      }
    } else {
      const ins = await supabase
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
      if (ins.error) return { error: new Error(ins.error.message) }
      channelId = ins.data.id
    }

    const link = await supabase.from('device_whitelist').insert({
      device_id: deviceId,
      channel_id: channelId,
      added_by: userId,
    })
    if (link.error) {
      if (link.error.code === '23505') return { error: null }
      return { error: new Error(link.error.message) }
    }

    await get().fetchWhitelistForDevice(deviceId)
    return { error: null }
  },

  removeChannelFromDevice: async (deviceId, channelId) => {
    const { error } = await supabase
      .from('device_whitelist')
      .delete()
      .eq('device_id', deviceId)
      .eq('channel_id', channelId)
    if (error) return { error: new Error(error.message) }
    set({ whitelist: get().whitelist.filter((c) => c.id !== channelId) })
    return { error: null }
  },

  addVideoToDevice: async ({ deviceId, userId, yt }) => {
    let videoId: string
    const existing = await supabase
      .from('whitelisted_videos')
      .select('id')
      .eq('youtube_video_id', yt.videoId)
      .maybeSingle()

    if (existing.data?.id) {
      videoId = existing.data.id
    } else {
      const ins = await supabase
        .from('whitelisted_videos')
        .insert({
          youtube_video_id: yt.videoId,
          title: yt.title,
          thumbnail_url: yt.thumbnail || null,
          youtube_channel_id: null,
          duration_seconds: null,
        })
        .select('id')
        .single()
      if (ins.error) return { error: new Error(ins.error.message) }
      videoId = ins.data.id
    }

    const link = await supabase.from('device_video_whitelist').insert({
      device_id: deviceId,
      video_id: videoId,
      added_by: userId,
    })
    if (link.error) {
      if (link.error.code === '23505') return { error: null }
      return { error: new Error(link.error.message) }
    }

    await get().fetchApprovedVideosForDevice(deviceId)
    return { error: null }
  },

  removeVideoFromDevice: async (deviceId, videoId) => {
    const { error } = await supabase
      .from('device_video_whitelist')
      .delete()
      .eq('device_id', deviceId)
      .eq('video_id', videoId)
    if (error) return { error: new Error(error.message) }
    set({ approvedVideos: get().approvedVideos.filter((v) => v.id !== videoId) })
    return { error: null }
  },

  fetchWhitelistForLocalParent: async (accessToken) => {
    set({ loading: true })
    const { data, error } = await supabase.rpc('local_parent_whitelist_for_device', {
      p_access_token: accessToken,
    })
    if (error) {
      set({ loading: false, whitelist: [] })
      return
    }
    const raw = data as unknown
    const arr = Array.isArray(raw) ? raw : []
    if (!Array.isArray(arr)) {
      set({ loading: false, whitelist: [] })
      return
    }
    const channels = arr as WhitelistedChannel[]
    set({ whitelist: channels, loading: false })
  },

  addChannelLocalParent: async ({ accessToken, pin, yt, category }) => {
    const normalizedCategory = category?.trim() ? category.trim() : null
    const { data, error } = await supabase.rpc('local_parent_add_channel', {
      p_access_token: accessToken,
      p_pin: pin,
      p_youtube_channel_id: yt.channelId,
      p_channel_name: yt.title,
      p_channel_thumbnail: yt.thumbnail ?? '',
      p_subscriber_count: yt.subscriberCount ?? '',
      p_description: yt.description ?? '',
      p_category: normalizedCategory ?? '',
    })
    if (error) return { error: new Error(error.message) }
    const row = data as { ok?: boolean; error?: string } | null
    if (!row?.ok) {
      const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה בהוספת ערוץ'
      return { error: new Error(msg) }
    }
    await get().fetchWhitelistForLocalParent(accessToken)
    return { error: null }
  },

  removeChannelLocalParent: async (accessToken, pin, channelId) => {
    const { data, error } = await supabase.rpc('local_parent_remove_channel', {
      p_access_token: accessToken,
      p_pin: pin,
      p_channel_id: channelId,
    })
    if (error) return { error: new Error(error.message) }
    const row = data as { ok?: boolean; error?: string } | null
    if (!row?.ok) {
      const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה בהסרה'
      return { error: new Error(msg) }
    }
    set({ whitelist: get().whitelist.filter((c) => c.id !== channelId) })
    return { error: null }
  },

  replaceChannelCacheLocalParent: async ({ accessToken, pin, channelDbId, videos, clearExisting = true }) => {
    const { data, error } = await supabase.rpc('local_parent_replace_channel_videos_cache', {
      p_access_token: accessToken,
      p_pin: pin,
      p_channel_id: channelDbId,
      p_videos: videos,
      p_clear_existing: clearExisting,
    })
    if (error) return { error: new Error(error.message) }
    const row = data as { ok?: boolean; error?: string } | null
    if (!row?.ok) {
      const msg = row?.error === 'invalid_pin' ? 'PIN שגוי' : row?.error ?? 'שגיאה ברענון מטמון'
      return { error: new Error(msg) }
    }
    return { error: null }
  },
}))
