import { useDailyWatchBudgetTracker } from '../../hooks/useDailyWatchBudgetTracker'

type Props = {
  deviceId: string | null | undefined
}

/** Headless tracker — mounts the daily watch budget hook for the active child device. */
export function DailyWatchBudgetTracker({ deviceId }: Props) {
  useDailyWatchBudgetTracker(deviceId)
  return null
}
