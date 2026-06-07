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
  lionLevel: number
  lionXp: number
  lionActiveOutfit: string
}

export type RaffleTicketSource =
  | 'lion_level_up'
  | 'screen_time_challenge'
  | 'manual_parent'

export type RaffleTicket = {
  id: string
  ticketCode: string
  source: RaffleTicketSource
  sourceRef: string | null
  earnedAt: string
}

export type RaffleTicketSummary = {
  raffleWeekStart: string
  ticketCount: number
  tickets: RaffleTicket[]
}

export type AwardRaffleTicketResult = {
  ticketId: string
  ticketCode: string
  raffleWeekStart: string
  source: RaffleTicketSource
  sourceRef: string | null
  alreadyExisted: boolean
}

const RAFFLE_SOURCES = new Set<RaffleTicketSource>([
  'lion_level_up',
  'screen_time_challenge',
  'manual_parent',
])

function normalizeRaffleSource(raw: unknown): RaffleTicketSource {
  const s = String(raw ?? '').trim() as RaffleTicketSource
  return RAFFLE_SOURCES.has(s) ? s : 'manual_parent'
}

function parseRaffleTicket(raw: unknown): RaffleTicket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = r.id != null ? String(r.id) : ''
  const ticketCode =
    typeof r.ticket_code === 'string'
      ? r.ticket_code
      : typeof r.ticketCode === 'string'
        ? r.ticketCode
        : ''
  if (!id.trim() || !ticketCode.trim()) return null
  return {
    id: id.trim(),
    ticketCode: ticketCode.trim(),
    source: normalizeRaffleSource(r.source),
    sourceRef:
      typeof r.source_ref === 'string'
        ? r.source_ref
        : typeof r.sourceRef === 'string'
          ? r.sourceRef
          : null,
    earnedAt: String(r.earned_at ?? r.earnedAt ?? new Date().toISOString()),
  }
}

function parseRaffleTickets(raw: unknown): RaffleTicket[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parseRaffleTicket).filter((t): t is RaffleTicket => t !== null)
}

function mapRaffleSummaryRow(row: Record<string, unknown>): RaffleTicketSummary {
  return {
    raffleWeekStart: String(row.raffle_week_start ?? row.raffleWeekStart ?? ''),
    ticketCount:
      typeof row.ticket_count === 'number'
        ? Math.max(0, row.ticket_count)
        : typeof row.ticketCount === 'number'
          ? Math.max(0, row.ticketCount)
          : 0,
    tickets: parseRaffleTickets(row.tickets),
  }
}

function mapAwardRaffleTicketRow(row: Record<string, unknown>): AwardRaffleTicketResult {
  return {
    ticketId: String(row.ticket_id ?? row.ticketId ?? ''),
    ticketCode: String(row.ticket_code ?? row.ticketCode ?? ''),
    raffleWeekStart: String(row.raffle_week_start ?? row.raffleWeekStart ?? ''),
    source: normalizeRaffleSource(row.source),
    sourceRef:
      typeof row.source_ref === 'string'
        ? row.source_ref
        : typeof row.sourceRef === 'string'
          ? row.sourceRef
          : null,
    alreadyExisted: Boolean(row.already_existed ?? row.alreadyExisted),
  }
}

const RUNTIME_CACHE_KEY = 'safetube_child_runtime_cache_v1'

export function mapChildRuntimeRow(row: Record<string, unknown>): ServerChildRuntime {
  const phase = row.screen_time_phase
  const validPhase: ScreenTimePhase =
    phase === 'active' || phase === 'challenge' || phase === 'locked' || phase === 'idle' ? phase : 'idle'

  const isBlocked = Boolean(row.is_blocked)
  const screenTimeBlocksPlayback = validPhase === 'challenge' || validPhase === 'locked'

  return {
    serverNow: String(row.server_now ?? new Date().toISOString()),
    deviceId: String(row.device_id ?? ''),
    isBlocked,
    screenTimePhase: validPhase,
    screenTimeLimitMinutes:
      typeof row.screen_time_limit_minutes === 'number' && row.screen_time_limit_minutes > 0
        ? row.screen_time_limit_minutes
        : 30,
    remainingSeconds:
      typeof row.remaining_seconds === 'number' && Number.isFinite(row.remaining_seconds)
        ? Math.max(0, Math.round(row.remaining_seconds))
        : null,
    playbackBlocked: Boolean(row.playback_blocked) || isBlocked || screenTimeBlocksPlayback,
    challengeTask: typeof row.challenge_task === 'string' ? row.challenge_task : null,
    lionLevel: typeof row.lion_level === 'number' && row.lion_level >= 1 ? row.lion_level : 1,
    lionXp: typeof row.lion_xp === 'number' && row.lion_xp >= 0 ? row.lion_xp : 0,
    lionActiveOutfit: typeof row.lion_active_outfit === 'string' ? row.lion_active_outfit : 'cub',
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
        lion_level: runtime.lionLevel,
        lion_xp: runtime.lionXp,
        lion_active_outfit: runtime.lionActiveOutfit,
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

export async function childGetRaffleTicketSummary(accessToken: string): Promise<{
  data: RaffleTicketSummary | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_raffle_ticket_summary', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapRaffleSummaryRow(row as Record<string, unknown>), error: null }
}

export async function childAwardRaffleTicket(
  accessToken: string,
  source: RaffleTicketSource,
  sourceRef?: string | null,
  metadata?: Record<string, unknown> | null
): Promise<{ data: AwardRaffleTicketResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_award_raffle_ticket', {
    p_access_token: accessToken,
    p_source: source,
    p_source_ref: sourceRef?.trim() ? sourceRef.trim() : null,
    p_metadata: metadata ?? {},
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapAwardRaffleTicketRow(row as Record<string, unknown>), error: null }
}

export class ChildPlaybackBlockedError extends Error {
  readonly reason: string | null
  constructor(reason: string | null) {
    super(
      reason === 'PARENT_BLOCKED'
        ? 'הצפייה חסומה מההורה.'
        : reason === 'SCREEN_TIME_BLOCKED'
          ? 'זמן הצפייה הסתיים.'
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
