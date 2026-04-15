export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  onboarding_done: boolean
  created_at: string
  updated_at: string
}

export interface Device {
  id: string
  user_id: string
  name: string
  device_type: 'phone' | 'tablet'
  pairing_code: string | null
  is_online: boolean
  is_blocked: boolean
  last_seen_at: string | null
  created_at: string
  updated_at: string
  channel_count?: number
}

export interface WhitelistedChannel {
  id: string
  youtube_channel_id: string
  channel_name: string
  channel_thumbnail: string | null
  subscriber_count: string | null
  description: string | null
  created_at: string
}

export interface WhitelistedVideo {
  id: string
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  youtube_channel_id: string | null
  duration_seconds: number | null
  created_at: string
}

export interface DeviceWhitelist {
  id: string
  device_id: string
  channel_id: string
  added_by: string
  added_at: string
  channel?: WhitelistedChannel
}

export interface Subscription {
  id: string
  user_id: string
  plan: 'trial' | 'monthly' | 'yearly'
  status: 'active' | 'expired' | 'cancelled' | 'payment_failed'
  trial_ends_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  max_devices: number
  created_at: string
  updated_at: string
}

export interface ActivityLog {
  id: string
  user_id: string
  device_id: string | null
  action:
    | 'block_enabled'
    | 'block_disabled'
    | 'channel_added'
    | 'channel_removed'
    | 'device_linked'
    | 'device_removed'
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface YouTubeChannelResult {
  channelId: string
  title: string
  thumbnail: string
  subscriberCount: string
  description: string
}

export interface YouTubeVideoResult {
  videoId: string
  title: string
  thumbnail: string
  channelTitle: string
}
