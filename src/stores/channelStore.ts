import { create } from 'zustand'
import type { WhitelistedChannel, YouTubeChannelResult } from '../types'
import { supabase } from '../lib/supabase'

interface ChannelState {
  whitelist: WhitelistedChannel[]
  searchResults: YouTubeChannelResult[]
  searchLoading: boolean
  searchError: string | null
  loading: boolean
  setWhitelist: (channels: WhitelistedChannel[]) => void
  fetchWhitelistForDevice: (deviceId: string) => Promise<void>
  setSearchResults: (results: YouTubeChannelResult[]) => void
  setSearchLoading: (v: boolean) => void
  setSearchError: (e: string | null) => void
  addChannelToDevice: (params: {
    deviceId: string
    userId: string
    yt: YouTubeChannelResult
  }) => Promise<{ error: Error | null }>
  removeChannelFromDevice: (deviceId: string, channelId: string) => Promise<{ error: Error | null }>
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  whitelist: [],
  searchResults: [],
  searchLoading: false,
  searchError: null,
  loading: false,

  setWhitelist: (whitelist) => set({ whitelist }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSearchLoading: (searchLoading) => set({ searchLoading }),
  setSearchError: (searchError) => set({ searchError }),

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

  addChannelToDevice: async ({ deviceId, userId, yt }) => {
    let channelId: string
    const existing = await supabase
      .from('whitelisted_channels')
      .select('id')
      .eq('youtube_channel_id', yt.channelId)
      .maybeSingle()

    if (existing.data?.id) {
      channelId = existing.data.id
    } else {
      const ins = await supabase
        .from('whitelisted_channels')
        .insert({
          youtube_channel_id: yt.channelId,
          channel_name: yt.title,
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
}))
