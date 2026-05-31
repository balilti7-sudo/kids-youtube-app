/** Friendly copy when playback must be blocked for live / upcoming streams. */
export const LIVE_UPCOMING_PLAYBACK_MESSAGE =
  'השידור החי הזה עדיין לא התחיל, בוא נבחר סרטון אחר! 🎬'

export const LIVE_STREAM_UNAVAILABLE_MESSAGE =
  'שידור חי לא זמין לניגון כרגע. בוא נבחר סרטון אחר! 🎬'

export type LiveStreamStatus =
  | 'not_live'
  | 'is_live'
  | 'is_upcoming'
  | 'was_live'
  | 'post_live'
  | 'unknown'

export type BridgeVideoInfo = {
  videoId: string
  liveStatus: LiveStreamStatus
  isLive: boolean
  isUpcoming: boolean
}

function normalizeLiveStatus(raw: unknown): LiveStreamStatus {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (s === 'is_live' || s === 'live') return 'is_live'
  if (s === 'is_upcoming' || s === 'upcoming') return 'is_upcoming'
  if (s === 'was_live') return 'was_live'
  if (s === 'post_live') return 'post_live'
  if (s === 'not_live' || s === 'none') return 'not_live'
  return 'unknown'
}

export function parseBridgeVideoInfo(body: Record<string, unknown>, videoId: string): BridgeVideoInfo {
  const liveStatus = normalizeLiveStatus(body.live_status ?? body.liveStatus)
  const isLive = Boolean(body.is_live ?? body.isLive) || liveStatus === 'is_live'
  const isUpcoming =
    Boolean(body.is_upcoming ?? body.isUpcoming) ||
    liveStatus === 'is_upcoming' ||
    Boolean(body.upcoming)

  return {
    videoId: String(body.videoId ?? videoId),
    liveStatus: isUpcoming ? 'is_upcoming' : isLive ? 'is_live' : liveStatus,
    isLive,
    isUpcoming,
  }
}

export function shouldBlockLivePlayback(info: BridgeVideoInfo): boolean {
  return info.isUpcoming || info.liveStatus === 'is_upcoming'
}

export function livePlaybackBlockMessage(info: BridgeVideoInfo): string {
  if (shouldBlockLivePlayback(info)) return LIVE_UPCOMING_PLAYBACK_MESSAGE
  if (info.isLive || info.liveStatus === 'is_live') return LIVE_STREAM_UNAVAILABLE_MESSAGE
  return LIVE_UPCOMING_PLAYBACK_MESSAGE
}

/** Heuristic for browse lists when live metadata is not cached yet. */
export function titleSuggestsUpcomingLive(title: string | null | undefined): boolean {
  const t = (title ?? '').trim()
  if (!t) return false
  return (
    /\b(upcoming|scheduled|premiere|starting soon)\b/i.test(t) ||
    /\b(שידור\s*חי\s*בקרוב|ישודר|טרם\s*התחיל|מע(?:[''])?\s*live)\b/i.test(t) ||
    /\(\s*live\s*\)\s*$/i.test(t)
  )
}

export function shouldHideFromChildBrowse(title: string | null | undefined): boolean {
  return titleSuggestsUpcomingLive(title)
}

export function streamErrorLooksLikeUpcomingLive(detail: string | null | undefined): boolean {
  const s = (detail ?? '').toLowerCase()
  if (!s) return false
  return (
    s.includes('live_upcoming') ||
    s.includes('is_upcoming') ||
    s.includes('premiere') ||
    (s.includes('live') && (s.includes('not started') || s.includes('upcoming') || s.includes('scheduled')))
  )
}
