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

export type RaffleTicketSource =
  | 'educational_intercept'
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

export type BedtimeTask = 'teeth' | 'bathroom'

export type ChildBedtimeState = {
  serverNow: string
  routineDate: string
  weekStart: string
  enabled: boolean
  teethConfirmed: boolean
  bathroomConfirmed: boolean
  tasksCompleted: boolean
  parentApproved: boolean
  canSpinWheel: boolean
  wheelSpun: boolean
  wheelPointsToday: number
  weeklyTotalPoints: number
  treasureThreshold: number
  treasureEligible: boolean
  treasureWindowOpen: boolean
  treasureOpened: boolean
  treasureClaimed: boolean
  treasurePrizeTitle: string
  treasurePrizeDescription: string
}

export type BedtimeTaskConfirmResult = {
  routineDate: string
  teethConfirmed: boolean
  bathroomConfirmed: boolean
  tasksCompleted: boolean
}

export type DailyWheelSpinResult = {
  routineDate: string
  weekStart: string
  pointsWon: number
  weeklyTotalPoints: number
  spinsToday: number
  alreadySpun: boolean
}

export type TreasureClaimResult = {
  weekStart: string
  weeklyTotalPoints: number
  treasureThreshold: number
  treasurePrizeTitle: string
  treasurePrizeDescription: string
  claimedAt: string
}

export type ParentBedtimeApproveResult = {
  deviceId: string
  routineDate: string
  parentApprovedAt: string | null
  canSpinWheel: boolean
}

export type ParentBedtimeState = {
  routineDate: string
  weekStart: string
  enabled: boolean
  teethConfirmed: boolean
  bathroomConfirmed: boolean
  tasksCompleted: boolean
  parentApproved: boolean
  parentApprovedAt: string | null
  wheelSpun: boolean
  wheelPointsToday: number
  weeklyTotalPoints: number
  treasureThreshold: number
  treasurePrizeTitle: string
  treasurePrizeDescription: string
}

export type BedtimeSettings = {
  deviceId: string
  enabled: boolean
  treasurePointsThreshold: number
  treasurePrizeTitle: string
  treasurePrizeDescription: string
  createdAt: string
  updatedAt: string
}

export const BEDTIME_ROUTINE_FORCE_ENABLED = false

export const BEDTIME_CHANGED_EVENT = 'safetube-bedtime-changed'

export function notifyBedtimeChanged() {
  try {
    window.dispatchEvent(new CustomEvent(BEDTIME_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

/** Show bedtime UI when an active child profile (device) is selected in the single-app flow. */
export function shouldShowBedtimeRoutineUi(activeDeviceId: string | null | undefined): boolean {
  return Boolean(activeDeviceId?.trim())
}

export function isBedtimeRoutineVisible(state: ChildBedtimeState | null | undefined): boolean {
  if (!state) return false
  return BEDTIME_ROUTINE_FORCE_ENABLED || state.enabled
}

/** Kid cannot browse channels until evening tasks are done and a parent approves. */
export function bedtimeBlocksChannelBrowse(state: ChildBedtimeState | null | undefined): boolean {
  if (!isBedtimeRoutineVisible(state)) return false
  return !state!.tasksCompleted || !state!.parentApproved
}

const BEDTIME_TASKS = new Set<BedtimeTask>(['teeth', 'bathroom'])

function normalizeBedtimeTask(task: BedtimeTask): BedtimeTask {
  return BEDTIME_TASKS.has(task) ? task : 'teeth'
}

function rowBool(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    if (typeof row[key] === 'boolean') return row[key]
  }
  return false
}

function rowInt(row: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof row[key] === 'number' && Number.isFinite(row[key])) {
      return Math.max(0, Math.round(row[key] as number))
    }
  }
  return fallback
}

function rowStr(row: Record<string, unknown>, fallback = '', ...keys: string[]): string {
  for (const key of keys) {
    if (typeof row[key] === 'string') return row[key]
    if (row[key] != null && typeof row[key] !== 'object') return String(row[key])
  }
  return fallback
}

function rowStrOrNull(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof row[key] === 'string') return row[key]
    if (row[key] == null) return null
  }
  return null
}

function mapChildBedtimeStateRow(row: Record<string, unknown>): ChildBedtimeState {
  const enabledFromRow = typeof row.enabled === 'boolean' ? row.enabled : true

  return {
    serverNow: rowStr(row, new Date().toISOString(), 'server_now', 'serverNow'),
    routineDate: rowStr(row, '', 'routine_date', 'routineDate'),
    weekStart: rowStr(row, '', 'week_start', 'weekStart'),
    enabled: BEDTIME_ROUTINE_FORCE_ENABLED || enabledFromRow,
    teethConfirmed: rowBool(row, 'teeth_confirmed', 'teethConfirmed'),
    bathroomConfirmed: rowBool(row, 'bathroom_confirmed', 'bathroomConfirmed'),
    tasksCompleted: rowBool(row, 'tasks_completed', 'tasksCompleted'),
    parentApproved: rowBool(row, 'parent_approved', 'parentApproved'),
    canSpinWheel: rowBool(row, 'can_spin_wheel', 'canSpinWheel'),
    wheelSpun: rowBool(row, 'wheel_spun', 'wheelSpun'),
    wheelPointsToday: rowInt(row, 0, 'wheel_points_today', 'wheelPointsToday'),
    weeklyTotalPoints: rowInt(row, 0, 'weekly_total_points', 'weeklyTotalPoints'),
    treasureThreshold: rowInt(row, 100, 'treasure_threshold', 'treasureThreshold'),
    treasureEligible: rowBool(row, 'treasure_eligible', 'treasureEligible'),
    treasureWindowOpen: rowBool(row, 'treasure_window_open', 'treasureWindowOpen'),
    treasureOpened: rowBool(row, 'treasure_opened', 'treasureOpened'),
    treasureClaimed: rowBool(row, 'treasure_claimed', 'treasureClaimed'),
    treasurePrizeTitle: rowStr(row, '', 'treasure_prize_title', 'treasurePrizeTitle'),
    treasurePrizeDescription: rowStr(row, '', 'treasure_prize_description', 'treasurePrizeDescription'),
  }
}

function mapBedtimeTaskConfirmRow(row: Record<string, unknown>): BedtimeTaskConfirmResult {
  return {
    routineDate: rowStr(row, '', 'out_routine_date', 'routine_date', 'routineDate'),
    teethConfirmed: rowBool(row, 'out_teeth_confirmed', 'teeth_confirmed', 'teethConfirmed'),
    bathroomConfirmed: rowBool(row, 'out_bathroom_confirmed', 'bathroom_confirmed', 'bathroomConfirmed'),
    tasksCompleted: rowBool(row, 'out_tasks_completed', 'tasks_completed', 'tasksCompleted'),
  }
}

function mapDailyWheelSpinRow(row: Record<string, unknown>): DailyWheelSpinResult {
  return {
    routineDate: rowStr(row, '', 'out_routine_date', 'routine_date', 'routineDate'),
    weekStart: rowStr(row, '', 'out_week_start', 'week_start', 'weekStart'),
    pointsWon: rowInt(row, 0, 'out_points_won', 'points_won', 'pointsWon'),
    weeklyTotalPoints: rowInt(row, 0, 'out_weekly_total_points', 'weekly_total_points', 'weeklyTotalPoints'),
    spinsToday: rowInt(row, 0, 'out_spins_today', 'spins_today', 'spinsToday'),
    alreadySpun: rowBool(row, 'out_already_spun', 'already_spun', 'alreadySpun'),
  }
}

function mapTreasureClaimRow(row: Record<string, unknown>): TreasureClaimResult {
  return {
    weekStart: rowStr(row, '', 'out_week_start', 'week_start', 'weekStart'),
    weeklyTotalPoints: rowInt(row, 0, 'out_weekly_total_points', 'weekly_total_points', 'weeklyTotalPoints'),
    treasureThreshold: rowInt(row, 100, 'out_treasure_threshold', 'treasure_threshold', 'treasureThreshold'),
    treasurePrizeTitle: rowStr(row, '', 'out_treasure_prize_title', 'treasure_prize_title', 'treasurePrizeTitle'),
    treasurePrizeDescription: rowStr(
      row,
      '',
      'out_treasure_prize_description',
      'treasure_prize_description',
      'treasurePrizeDescription'
    ),
    claimedAt: rowStr(row, '', 'out_claimed_at', 'claimed_at', 'claimedAt'),
  }
}

function mapParentBedtimeApproveRow(row: Record<string, unknown>): ParentBedtimeApproveResult {
  return {
    deviceId: rowStr(row, '', 'out_device_id', 'device_id', 'deviceId'),
    routineDate: rowStr(row, '', 'out_routine_date', 'routine_date', 'routineDate'),
    parentApprovedAt: rowStrOrNull(
      row,
      'out_parent_approved_at',
      'parent_approved_at',
      'parentApprovedAt'
    ),
    canSpinWheel: rowBool(row, 'out_can_spin_wheel', 'can_spin_wheel', 'canSpinWheel'),
  }
}

function mapParentBedtimeStateRow(row: Record<string, unknown>): ParentBedtimeState {
  return {
    routineDate: rowStr(row, '', 'routine_date', 'routineDate'),
    weekStart: rowStr(row, '', 'week_start', 'weekStart'),
    enabled: rowBool(row, 'enabled'),
    teethConfirmed: rowBool(row, 'teeth_confirmed', 'teethConfirmed'),
    bathroomConfirmed: rowBool(row, 'bathroom_confirmed', 'bathroomConfirmed'),
    tasksCompleted: rowBool(row, 'tasks_completed', 'tasksCompleted'),
    parentApproved: rowBool(row, 'parent_approved', 'parentApproved'),
    parentApprovedAt: rowStrOrNull(row, 'parent_approved_at', 'parentApprovedAt'),
    wheelSpun: rowBool(row, 'wheel_spun', 'wheelSpun'),
    wheelPointsToday: rowInt(row, 0, 'wheel_points_today', 'wheelPointsToday'),
    weeklyTotalPoints: rowInt(row, 0, 'weekly_total_points', 'weeklyTotalPoints'),
    treasureThreshold: rowInt(row, 100, 'treasure_threshold', 'treasureThreshold'),
    treasurePrizeTitle: rowStr(row, '', 'treasure_prize_title', 'treasurePrizeTitle'),
    treasurePrizeDescription: rowStr(row, '', 'treasure_prize_description', 'treasurePrizeDescription'),
  }
}

function mapBedtimeSettingsRow(row: Record<string, unknown>): BedtimeSettings {
  return {
    deviceId: rowStr(row, '', 'device_id', 'deviceId'),
    enabled: rowBool(row, 'enabled'),
    treasurePointsThreshold: rowInt(row, 100, 'treasure_points_threshold', 'treasurePointsThreshold'),
    treasurePrizeTitle: rowStr(row, 'Weekly treasure prize!', 'treasure_prize_title', 'treasurePrizeTitle'),
    treasurePrizeDescription: rowStr(
      row,
      'Great job with bedtime routine!',
      'treasure_prize_description',
      'treasurePrizeDescription'
    ),
    createdAt: rowStr(row, '', 'created_at', 'createdAt'),
    updatedAt: rowStr(row, '', 'updated_at', 'updatedAt'),
  }
}

const RAFFLE_SOURCES = new Set<RaffleTicketSource>([
  'educational_intercept',
  'lion_level_up',
  'screen_time_challenge',
  'manual_parent',
])

function normalizeRaffleSource(raw: unknown): RaffleTicketSource {
  const s = String(raw ?? '').trim() as RaffleTicketSource
  return RAFFLE_SOURCES.has(s) ? s : 'educational_intercept'
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

export async function childGetBedtimeState(accessToken: string): Promise<{
  data: ChildBedtimeState | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_get_bedtime_state', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapChildBedtimeStateRow(row as Record<string, unknown>), error: null }
}

export async function childConfirmBedtimeTask(
  accessToken: string,
  task: BedtimeTask
): Promise<{ data: BedtimeTaskConfirmResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('child_confirm_bedtime_task', {
    p_access_token: accessToken,
    p_task: normalizeBedtimeTask(task),
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapBedtimeTaskConfirmRow(row as Record<string, unknown>), error: null }
}

export async function childSpinDailyWheel(accessToken: string): Promise<{
  data: DailyWheelSpinResult | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_spin_daily_wheel', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapDailyWheelSpinRow(row as Record<string, unknown>), error: null }
}

export async function childClaimTreasureChest(accessToken: string): Promise<{
  data: TreasureClaimResult | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('child_claim_treasure_chest', {
    p_access_token: accessToken,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapTreasureClaimRow(row as Record<string, unknown>), error: null }
}

export async function ownerGetBedtimeState(deviceId: string): Promise<{
  data: ChildBedtimeState | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('owner_get_bedtime_state', {
    p_device_id: deviceId,
  })
  if (error) {
    console.error('[Bedtime] owner_get_bedtime_state RPC error', {
      deviceId,
      message: error.message,
      code: error.code,
      details: error.details,
    })
    return { data: null, error: new Error(error.message) }
  }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapChildBedtimeStateRow(row as Record<string, unknown>), error: null }
}

export async function ownerConfirmBedtimeTask(
  deviceId: string,
  task: BedtimeTask
): Promise<{ data: BedtimeTaskConfirmResult | null; error: Error | null }> {
  const { data: sessionWrap } = await supabase.auth.getSession()
  if (!sessionWrap.session) {
    const err = new Error('AUTH_SESSION_MISSING')
    console.error('[Bedtime] owner_confirm_bedtime_task: no Supabase auth session', {
      deviceId,
      task,
    })
    return { data: null, error: err }
  }

  console.info('[Bedtime] owner_confirm_bedtime_task RPC start', {
    deviceId,
    task,
    userId: sessionWrap.session.user.id,
  })

  const { data, error } = await supabase.rpc('owner_confirm_bedtime_task', {
    p_device_id: deviceId,
    p_task: normalizeBedtimeTask(task),
  })

  if (error) {
    console.error('[Bedtime] owner_confirm_bedtime_task RPC error', {
      deviceId,
      task,
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { data: null, error: new Error(error.message) }
  }

  const row = Array.isArray(data) ? data[0] : null
  if (!row) {
    console.error('[Bedtime] owner_confirm_bedtime_task RPC returned no row', {
      deviceId,
      task,
      raw: data,
    })
    return { data: null, error: new Error('EMPTY_RPC_RESPONSE') }
  }

  const mapped = mapBedtimeTaskConfirmRow(row as Record<string, unknown>)
  console.info('[Bedtime] owner_confirm_bedtime_task RPC ok', { deviceId, task, mapped })
  return { data: mapped, error: null }
}

export async function ownerSpinDailyWheel(deviceId: string): Promise<{
  data: DailyWheelSpinResult | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('owner_spin_daily_wheel', {
    p_device_id: deviceId,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapDailyWheelSpinRow(row as Record<string, unknown>), error: null }
}

export async function ownerClaimTreasureChest(deviceId: string): Promise<{
  data: TreasureClaimResult | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('owner_claim_treasure_chest', {
    p_device_id: deviceId,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapTreasureClaimRow(row as Record<string, unknown>), error: null }
}

export async function parentApproveBedtime(
  deviceId: string,
  routineDate?: string | null
): Promise<{ data: ParentBedtimeApproveResult | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('parent_approve_bedtime', {
    p_device_id: deviceId,
    p_routine_date: routineDate?.trim() ? routineDate.trim() : null,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapParentBedtimeApproveRow(row as Record<string, unknown>), error: null }
}

export async function parentGetBedtimeState(
  deviceId: string,
  routineDate?: string | null
): Promise<{ data: ParentBedtimeState | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('parent_get_bedtime_state', {
    p_device_id: deviceId,
    p_routine_date: routineDate?.trim() ? routineDate.trim() : null,
  })
  if (error) return { data: null, error: new Error(error.message) }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { data: null, error: null }
  return { data: mapParentBedtimeStateRow(row as Record<string, unknown>), error: null }
}

export async function parentUpdateBedtimeSettings(
  deviceId: string,
  updates: {
    enabled?: boolean
    treasurePointsThreshold?: number
    treasurePrizeTitle?: string
    treasurePrizeDescription?: string
  }
): Promise<{ data: BedtimeSettings | null; error: Error | null }> {
  const { data, error } = await supabase.rpc('parent_update_bedtime_settings', {
    p_device_id: deviceId,
    p_enabled: updates.enabled ?? null,
    p_treasure_points_threshold:
      typeof updates.treasurePointsThreshold === 'number'
        ? Math.round(updates.treasurePointsThreshold)
        : null,
    p_treasure_prize_title: updates.treasurePrizeTitle?.trim() ? updates.treasurePrizeTitle.trim() : null,
    p_treasure_prize_description: updates.treasurePrizeDescription?.trim()
      ? updates.treasurePrizeDescription.trim()
      : null,
  })
  if (error) return { data: null, error: new Error(error.message) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data: null, error: null }
  }
  return { data: mapBedtimeSettingsRow(data as Record<string, unknown>), error: null }
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
