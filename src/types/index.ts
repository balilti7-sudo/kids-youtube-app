export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  /** Parent PIN for sensitive actions (e.g. channel list); DB default often 0000 */
  parent_pin?: string | null
  /** Optional parity field; gate may fall back here if `parent_pin` is unset (see migration 020). */
  access_code?: string | null
  onboarding_done: boolean
  created_at: string
  updated_at: string
}

export type EducationalInterceptFrequency = 2 | 3 | 5

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
  educational_intercepts_enabled?: boolean
  educational_intercept_frequency?: EducationalInterceptFrequency
}

export interface WhitelistedChannel {
  id: string
  youtube_channel_id: string
  channel_name: string
  category: string | null
  channel_thumbnail: string | null
  subscriber_count: string | null
  description: string | null
  last_videos_refresh_at?: string | null
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
