import type { ChildBedtimeState } from './childRuntime'

/** Child started tasks or is waiting for parent approval — do not hard-lock with full-screen timer. */
export function isBedtimeRoutineInProgress(state: ChildBedtimeState | null | undefined): boolean {
  if (!state) return false
  if (state.teethConfirmed || state.bathroomConfirmed) return true
  if (state.tasksCompleted && !state.parentApproved && !state.wheelSpun) return true
  return false
}
