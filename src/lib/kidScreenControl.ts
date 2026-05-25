import type { ChildDeviceState } from './childDevice'

export type KidScreenBreakReason = 'time_limit' | 'bedtime'

export function parseSleepTimeStart(value: string | null | undefined): { hours: number; minutes: number } | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return { hours: h, minutes: m }
}

export function isPastBedtime(sleepTimeStart: string | null | undefined, now = new Date()): boolean {
  const parsed = parseSleepTimeStart(sleepTimeStart)
  if (!parsed) return false
  const startMinutes = parsed.hours * 60 + parsed.minutes
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= startMinutes
}

export function isOverTimeLimit(
  limitMinutes: number | null | undefined,
  watchSecondsToday: number
): boolean {
  if (limitMinutes == null || limitMinutes <= 0) return false
  return watchSecondsToday >= limitMinutes * 60
}

export function evaluateKidScreenBreak(
  device: ChildDeviceState | null,
  now = new Date()
): KidScreenBreakReason | null {
  if (!device || device.is_blocked) return null
  if (isOverTimeLimit(device.time_limit_minutes, device.watch_seconds_today)) return 'time_limit'
  if (isPastBedtime(device.sleep_time_start, now)) return 'bedtime'
  return null
}

export function formatWatchMinutes(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} דק׳`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h} שע׳ ${m} דק׳` : `${h} שע׳`
}
