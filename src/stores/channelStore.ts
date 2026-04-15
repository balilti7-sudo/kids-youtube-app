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
}))
