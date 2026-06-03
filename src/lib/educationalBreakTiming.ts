import type { EducationalBreakIntervalMinutes } from '../types'

/** Show the pre-break overlay in the final minute before the threshold. */
export const PRE_BREAK_COUNTDOWN_SECONDS = 60

export function breakThresholdSeconds(
  intervalMinutes: EducationalBreakIntervalMinutes | number
): number {
  const minutes = Math.max(1, Math.round(Number(intervalMinutes) || 30))
  return minutes * 60
}

export function secondsUntilBreak(
  watchSeconds: number,
  intervalMinutes: EducationalBreakIntervalMinutes | number
): number {
  const watched = Math.max(0, Math.floor(watchSeconds))
  return Math.max(0, breakThresholdSeconds(intervalMinutes) - watched)
}

export function isInPreBreakCountdownWindow(
  watchSeconds: number,
  intervalMinutes: EducationalBreakIntervalMinutes | number
): boolean {
  const remaining = secondsUntilBreak(watchSeconds, intervalMinutes)
  return remaining > 0 && remaining <= PRE_BREAK_COUNTDOWN_SECONDS
}

export function formatPreBreakCountdownLabel(secondsRemaining: number): string {
  const s = Math.max(0, Math.ceil(secondsRemaining))
  if (s >= 120) {
    const minutes = Math.ceil(s / 60)
    return `עוד ${minutes} דקות להפסקה`
  }
  if (s >= 60) {
    return 'עוד דקה להפסקה'
  }
  if (s <= 1) {
    return 'הפסקה בעוד שנייה'
  }
  return `עוד ${s} שניות להפסקה`
}
