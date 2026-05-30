import type { InterceptPendingVideo } from './educationalIntercept'
import { getSavedChildAccessToken } from './childDevice'
import { supabase } from './supabase'

export type ScreenTimePhase = 'idle' | 'active' | 'challenge' | 'locked'

export type ServerChildRuntime = {
  serverNow: string
  deviceId: string
  isBlocked: boolean
  screenTimePhase: ScreenTimePhase
  screenTimeLimitMinutes: number
  remainingSeconds: number | null
  playbackBlocked: boolean
  challengeTask: string | null
  interceptActive: boolean
  interceptVideoCount: number
  interceptPendingVideo: InterceptPendingVideo | null
  interceptSceneProgress: string[]
  lionLevel: number
  lionXp: number
  lionActiveOutfit: string
  educationalInterceptEnabled: boolean
  educationalInterceptFrequency: 2 | 3 | 5
}

export type CompleteInterceptResult = {
  lionLevel: number
  lionXp: number
  leveledUp: boolean
  levelsGained: number
  xpGained: number
}

const RUNTIME_CACHE_KEY = 'safetube_child_runtime_cache_v1'

function normalizeFrequency(raw: unknown): 2 | 3 | 5 {
  const s = typeof raw === 'number' ? String(raw) : String(raw ?? '3').trim()
  if (s === '2' || s === '5') return Number(s) as 2 | 5
  return 3
}

function parsePendingVideo(raw: unknown): InterceptPendingVideo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const videoId = typeof v.videoId === 'string' ? v.videoId : typeof v.video_id === 'string' ? v.video_id : ''
  if (!videoId.trim()) return null
  return {
    videoId: videoId.trim(),
    title: typeof v.title === 'string' ? v.title : undefined,
    channelTitle: typeof v.channelTitle === 'string' ? v.channelTitle : undefined,
    posterUrl: typeof v.posterUrl === 'string' ? v.posterUrl : null,
  }
}

function parseSceneProgress(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string')
}

export function mapChildRuntimeRow(row: Record<string, unknown>): ServerChildRuntime {
  const phase = row.screen_time_phase
  const validPhase: ScreenTimePhase =
    phase === 'active' || phase === 'challenge' || phase === 'locked' || phase === 'idle' ? phase : 'idle'

  return {
    serverNow: String(row.server_now ?? new Date().toISOString()),
    deviceId: String(row.device_id ?? ''),
    isBlocked: Boolean(row.is_blocked),
    screenTimePhase: validPhase,
    screenTimeLimitMinutes:
      typeof row.screen_time_limit_minutes === 'number' && row.screen_time_limit_minutes > 0
        ? row.screen_time_limit_minutes
        : 30,
    remainingSeconds:
      typeof row.remaining_seconds === 'number' && Number.isFinite(row.remaining_seconds)
        ? Math.max(0, Math.round(row.remaining_seconds))
        : null,
    playbackBlocked: Boolean(row.playback_blocked),
    challengeTask: typeof row.challenge_task === 'string' ? row.challenge_task : null,
    interceptActive: Boolean(row.intercept_active),
    interceptVideoCount:
      typeof row.intercept_video_count === 'number' && row.intercept_video_count >= 0
        ? row.intercept_video_count
        : 0,
    interceptPendingVideo: parsePendingVideo(row.intercept_pending_video),
    interceptSceneProgress: parseSceneProgress(row.intercept_scene_progress),
    lionLevel: typeof row.lion_level === 'number' && row.lion_level >= 1 ? row.lion_level : 1,
    lionXp: typeof row.lion_xp === 'number' && row.lion_xp >= 0 ? row.lion_xp : 0,
    lionActiveOutfit: typeof row.lion_active_outfit === 'string' ? row.lion_active_outfit : 'cub',
    educationalInterceptEnabled: Boolean(row.educational_intercept_enabled),
    educationalInterceptFrequency: normalizeFrequency(row.educational_intercept_frequency),
  }
}

export function readCachedChildRuntime(): ServerChildRuntime | null {
  try {
    const raw = sessionStorage.getItem(RUNTIME_CACHE_KEY)
    if (!raw) return null
    return mapChildRuntimeRow(JSON.parse(raw) as Record<string, unknown>)
  } catch {
    return null
  }
}

export function writeCachedChildRuntime(runtime: ServerChildRuntime) {
  try {
    sessionStorage.setItem(
      RUNTIME_CACHE_KEY,
      JSON.stringify({
        server_now: runtime.serverNow,
        device_id: runtime.deviceId,
        is_blocked: runtime.isBlocked,
        screen_time_phase: runtime.screenTimePhase,
        screen_time_limit_minutes: runtime.screenTimeLimitMinutes,
        remaining_seconds: runtime.remainingSeconds,
        playback_blocked: runtime.playbackBlocked,
        challenge_task: runtime.challengeTask,
        intercept_active: runtime.interceptActive,
        intercept_video_count: runtime.interceptVideoCount,
        intercept_pending_video: runtime.interceptPendingVideo,
        intercept_scene_progress: runtime.interceptSceneProgress,
        lion_level: runtime.lionLevel,
        lion_xp: runtime.lionXp,
        lion_active_outfit: runtime.lionActiveOutfit,
        educational_intercept_enabled: runtime.educationalInterceptEnabled,
        educational_intercept_frequency: runtime.educationalInterceptFrequency,
      })
    )
  } catch {
    /* ignore */
  }
}

export function clearCachedChildRuntime() {
  try {
    sessionStorage.removeItem(RUNTIME_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

export async function childTickScreenTime(accessToken: string): Promise<{
  data: ServerChildRuntime | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_tick_screen_time', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  const mapped = mapChildRuntimeRow(row as Record<string, unknown>)
  writeCachedChildRuntime(mapped)
  return { data: mapped, error: null }
}

export async function parentStartScreenTime(
  deviceId: string,
  limitMinutes: number
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('parent_start_screen_time', {
    p_device_id: deviceId,
    p_limit_minutes: Math.round(limitMinutes),
  })
  return { error: error ? new Error(error.message) : null }
}

export async function childCompleteScreenTimeChallenge(accessToken: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('child_complete_screen_time_challenge', {
    p_access_token: accessToken,
  })
  return { error: error ? new Error(error.message) : null }
}

export async function childAssertPlaybackAllowed(accessToken: string): Promise<{
  allowed: boolean
  reason: string | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_assert_playback_allowed', {
    p_access_token: accessToken,
  })
  if (error) return { allowed: false, reason: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { allowed: false, reason: 'NO_DEVICE', error: null }
  const r = row as Record<string, unknown>
  return {
    allowed: Boolean(r.allowed),
    reason: typeof r.reason === 'string' ? r.reason : null,
    error: null,
  }
}

export async function childTryBeginPlayback(
  accessToken: string,
  pendingVideo: InterceptPendingVideo | null
): Promise<{ allowed: boolean; interceptActivated: boolean; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_try_begin_playback', {
    p_access_token: accessToken,
    p_pending_video: pendingVideo,
  })
  if (error) return { allowed: false, interceptActivated: false, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { allowed: false, interceptActivated: false, error: null }
  const r = row as Record<string, unknown>
  return {
    allowed: Boolean(r.allowed),
    interceptActivated: Boolean(r.intercept_activated),
    error: null,
  }
}

export async function childReportVideoPlaybackStarted(
  accessToken: string,
  videoId: string
): Promise<{ count: number; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_report_video_playback_started', {
    p_access_token: accessToken,
    p_video_id: videoId,
  })
  if (error) return { count: 0, error: new Error(error.message) }
  return { count: typeof data === 'number' ? data : 0, error: null }
}

export async function childMarkInterceptItemFixed(
  accessToken: string,
  itemId: string
): Promise<{ progress: string[]; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_mark_intercept_item_fixed', {
    p_access_token: accessToken,
    p_item_id: itemId,
  })
  if (error) return { progress: [], error: new Error(error.message) }
  return { progress: parseSceneProgress(data), error: null }
}

export async function childCompleteIntercept(accessToken: string): Promise<{
  data: CompleteInterceptResult | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_complete_intercept', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  const r = row as Record<string, unknown>
  return {
    data: {
      lionLevel: typeof r.lion_level === 'number' ? r.lion_level : 1,
      lionXp: typeof r.lion_xp === 'number' ? r.lion_xp : 0,
      leveledUp: Boolean(r.leveled_up),
      levelsGained: typeof r.levels_gained === 'number' ? r.levels_gained : 0,
      xpGained: typeof r.xp_gained === 'number' ? r.xp_gained : 50,
    },
    error: null,
  }
}

export async function childEquipLionOutfit(
  accessToken: string,
  outfitId: string
): Promise<{ outfitId: string; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_equip_lion_outfit', {
    p_access_token: accessToken,
    p_outfit_id: outfitId,
  })
  if (error) return { outfitId, error: new Error(error.message) }
  return { outfitId: typeof data === 'string' ? data : outfitId, error: null }
}

export class ChildPlaybackBlockedError extends Error {
  readonly reason: string | null
  constructor(reason: string | null) {
    super(
      reason === 'PARENT_BLOCKED'
        ? 'הצפייה חסומה מההורה.'
        : reason === 'SCREEN_TIME_BLOCKED'
          ? 'זמן הצפייה הסתיים.'
          : reason === 'INTERCEPT_ACTIVE'
            ? 'יש להשלים את ההפסקה החינוכית.'
            : 'הניגון חסום כרגע.'
    )
    this.name = 'ChildPlaybackBlockedError'
    this.reason = reason
  }
}

/** Called before Media Bridge / iframe resolve when a child token is present. */
export async function assertChildPlaybackAllowedForStream(): Promise<void> {
  const token = getSavedChildAccessToken()
  if (!token) return
  const { allowed, reason, error } = await childAssertPlaybackAllowed(token)
  if (error) throw error
  if (!allowed) throw new ChildPlaybackBlockedError(reason)
}
