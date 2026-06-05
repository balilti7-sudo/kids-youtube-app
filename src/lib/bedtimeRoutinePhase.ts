import type { ChildBedtimeState } from './childRuntime'
import { isBedtimeRoutineVisible } from './childRuntime'

export type BedtimeRoutinePhase = 'none' | 'passive' | 'countdown' | 'routine'

export const DEFAULT_BEDTIME_GRACE_MINUTES = 5

export function normalizeGracePeriodMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_BEDTIME_GRACE_MINUTES
  return Math.min(120, Math.max(1, Math.round(n)))
}

export function getGraceCountdownEndsAtMs(bedtime: ChildBedtimeState | null | undefined): number | null {
  if (!bedtime?.graceCountdownStartedAt) return null
  const started = new Date(bedtime.graceCountdownStartedAt).getTime()
  if (!Number.isFinite(started)) return null
  const minutes = normalizeGracePeriodMinutes(bedtime.gracePeriodMinutes)
  return started + minutes * 60 * 1000
}

export function getGraceCountdownRemainingSeconds(
  bedtime: ChildBedtimeState | null | undefined,
  now = Date.now()
): number {
  const endsAt = getGraceCountdownEndsAtMs(bedtime)
  if (endsAt == null) return 0
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

export function getBedtimeRoutinePhase(
  bedtime: ChildBedtimeState | null | undefined,
  options?: { dismissedForTonight?: boolean; now?: number }
): BedtimeRoutinePhase {
  if (!bedtime || !isBedtimeRoutineVisible(bedtime) || bedtime.wheelSpun) return 'none'
  if (options?.dismissedForTonight) return 'none'

  if (!bedtime.graceCountdownStartedAt) return 'passive'

  const remaining = getGraceCountdownRemainingSeconds(bedtime, options?.now)
  if (remaining > 0) return 'countdown'

  return 'routine'
}
