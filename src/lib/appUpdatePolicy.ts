import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { APP_VERSION } from './appVersion'
import { isSupabaseConfigured, supabase } from './supabase'
import { isVersionOlder } from './semver'

export type AppUpdatePlatform = 'android' | 'web' | 'ios'

export type AppReleasePolicy = {
  platform: AppUpdatePlatform
  latestVersion: string
  minRequiredVersion: string
  releasedAt: string
  gracePeriodDays: number
  storeUrl: string
  titleHe: string
  messageHe: string
}

export type AppUpdateGateState =
  | { status: 'ok' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | {
      status: 'soft' | 'hard'
      installedVersion: string
      policy: AppReleasePolicy
      daysSinceRelease: number
      daysRemainingInGrace: number
    }

const CACHE_KEY = 'safetube.app_release_policy.v1'
const DISMISS_PREFIX = 'safetube.update.softDismissed.'

export function resolveUpdatePlatform(): AppUpdatePlatform {
  if (!Capacitor.isNativePlatform()) return 'web'
  const p = Capacitor.getPlatform()
  if (p === 'ios') return 'ios'
  return 'android'
}

export async function getInstalledAppVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await App.getInfo()
      if (info.version?.trim()) return info.version.trim()
    } catch {
      /* fall through */
    }
  }
  const fromEnv = String(import.meta.env.VITE_APP_VERSION || '').trim()
  if (fromEnv) return fromEnv
  return APP_VERSION || '0.0.0'
}

function mapPolicyRow(row: Record<string, unknown>): AppReleasePolicy | null {
  const platform = String(row.platform || '').toLowerCase()
  if (platform !== 'android' && platform !== 'web' && platform !== 'ios') return null
  const latestVersion = String(row.latest_version || '').trim()
  const minRequiredVersion = String(row.min_required_version || '').trim()
  const releasedAt = String(row.released_at || '').trim()
  const storeUrl = String(row.store_url || '').trim()
  if (!latestVersion || !minRequiredVersion || !releasedAt || !storeUrl) return null
  const grace = Number(row.grace_period_days)
  return {
    platform,
    latestVersion,
    minRequiredVersion,
    releasedAt,
    gracePeriodDays: Number.isFinite(grace) ? Math.max(0, grace) : 14,
    storeUrl,
    titleHe: String(row.title_he || 'יש עדכון חדש ל-SafeTube'),
    messageHe: String(
      row.message_he || 'גרסה חדשה זמינה. מומלץ לעדכן כדי להמשיך להשתמש באפליקציה.'
    ),
  }
}

function readCachedPolicy(platform: AppUpdatePlatform): AppReleasePolicy | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { platform?: string; policy?: Record<string, unknown> }
    if (parsed.platform !== platform || !parsed.policy) return null
    return mapPolicyRow({
      platform: parsed.policy.platform ?? platform,
      latest_version: parsed.policy.latestVersion,
      min_required_version: parsed.policy.minRequiredVersion,
      released_at: parsed.policy.releasedAt,
      grace_period_days: parsed.policy.gracePeriodDays,
      store_url: parsed.policy.storeUrl,
      title_he: parsed.policy.titleHe,
      message_he: parsed.policy.messageHe,
    })
  } catch {
    return null
  }
}

function writeCachedPolicy(policy: AppReleasePolicy): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ platform: policy.platform, policy }))
  } catch {
    /* ignore */
  }
}

export function softDismissKey(platform: AppUpdatePlatform, latestVersion: string): string {
  return `${DISMISS_PREFIX}${platform}.${latestVersion}`
}

export function isSoftUpdateDismissed(platform: AppUpdatePlatform, latestVersion: string): boolean {
  try {
    return localStorage.getItem(softDismissKey(platform, latestVersion)) === '1'
  } catch {
    return false
  }
}

export function dismissSoftUpdate(platform: AppUpdatePlatform, latestVersion: string): void {
  try {
    localStorage.setItem(softDismissKey(platform, latestVersion), '1')
  } catch {
    /* ignore */
  }
}

export async function fetchAppReleasePolicy(
  platform: AppUpdatePlatform = resolveUpdatePlatform()
): Promise<AppReleasePolicy | null> {
  if (!isSupabaseConfigured) return readCachedPolicy(platform)

  try {
    const { data, error } = await supabase.rpc('get_app_release_policy', {
      p_platform: platform,
    })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object') return readCachedPolicy(platform)
    const policy = mapPolicyRow(row as Record<string, unknown>)
    if (policy) writeCachedPolicy(policy)
    return policy ?? readCachedPolicy(platform)
  } catch (err) {
    console.warn('[appUpdate] policy fetch failed', err)
    return readCachedPolicy(platform)
  }
}

function daysBetween(fromIso: string, to = new Date()): number {
  const from = new Date(fromIso).getTime()
  if (!Number.isFinite(from)) return 0
  const ms = to.getTime() - from
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

/**
 * Evaluate soft / hard lock from installed version + remote policy.
 * - Below min_required → hard immediately
 * - Below latest, within grace → soft (dismissible)
 * - Below latest, after grace → hard
 */
export function evaluateAppUpdateGate(
  installedVersion: string,
  policy: AppReleasePolicy | null
): AppUpdateGateState {
  if (!policy) return { status: 'unavailable' }

  const belowMin = isVersionOlder(installedVersion, policy.minRequiredVersion)
  const belowLatest = isVersionOlder(installedVersion, policy.latestVersion)
  if (!belowMin && !belowLatest) return { status: 'ok' }

  const daysSinceRelease = daysBetween(policy.releasedAt)
  const grace = policy.gracePeriodDays
  const daysRemainingInGrace = Math.max(0, grace - daysSinceRelease)
  const pastGrace = daysSinceRelease >= grace

  if (belowMin || pastGrace) {
    return {
      status: 'hard',
      installedVersion,
      policy,
      daysSinceRelease,
      daysRemainingInGrace: 0,
    }
  }

  return {
    status: 'soft',
    installedVersion,
    policy,
    daysSinceRelease,
    daysRemainingInGrace,
  }
}

export async function resolveAppUpdateGate(): Promise<AppUpdateGateState> {
  const platform = resolveUpdatePlatform()
  const [installedVersion, policy] = await Promise.all([
    getInstalledAppVersion(),
    fetchAppReleasePolicy(platform),
  ])
  return evaluateAppUpdateGate(installedVersion, policy)
}
