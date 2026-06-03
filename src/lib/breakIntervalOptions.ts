import {
  EDUCATIONAL_BREAK_INTERVAL_MINUTES,
  type EducationalBreakIntervalMinutes,
} from '../types'

const BREAK_INTERVAL_LABELS: Record<EducationalBreakIntervalMinutes, string> = {
  5: '5 דקות',
  10: '10 דקות',
  15: '15 דקות',
  30: '30 דקות',
  45: '45 דקות',
  60: '60 דקות',
}

/** Parent dashboard: break interval dropdown (values sent as `p_break_interval_minutes`). */
export const INTERCEPT_BREAK_INTERVAL_OPTIONS = EDUCATIONAL_BREAK_INTERVAL_MINUTES.map((value) => ({
  value,
  label: BREAK_INTERVAL_LABELS[value],
}))
