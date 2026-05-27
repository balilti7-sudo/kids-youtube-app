export const SCREEN_TIME_CHANGED_EVENT = 'safetube-screen-time-changed'

export type ScreenTimePhase = 'idle' | 'active' | 'challenge' | 'locked'

export type LocalScreenTimeState = {
  phase: ScreenTimePhase
  limitMinutes: number
  sessionStartedAt: number | null
  challengeTask: string | null
}

const STORAGE_KEY = 'safetube_local_screen_time_v1'
const DEFAULT_LIMIT_MINUTES = 30

export const GIFT_CHALLENGE_TASKS = [
  'תן חיבוק ענק לאבא או אמא!',
  'סדר 3 צעצועים או ספרים במקום.',
  'שתה כוס מים שלמה בישיבה.',
  'מצא 3 חפצים בצבע כחול בחדר וגע בהם.',
  'אמור למישהו בבית "תודה" בקול רם וחיוך.',
  'עשה 5 קפיצות קטנות במקום.',
  'ספר בקול לאחד מבני הבית על היום שלך.',
] as const

function dispatchChanged() {
  try {
    window.dispatchEvent(new CustomEvent(SCREEN_TIME_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

function defaultState(): LocalScreenTimeState {
  return {
    phase: 'idle',
    limitMinutes: DEFAULT_LIMIT_MINUTES,
    sessionStartedAt: null,
    challengeTask: null,
  }
}

export function readLocalScreenTime(): LocalScreenTimeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as Partial<LocalScreenTimeState>
    const phase = parsed.phase
    const validPhase: ScreenTimePhase =
      phase === 'active' || phase === 'challenge' || phase === 'locked' || phase === 'idle' ? phase : 'idle'
    const limitMinutes =
      typeof parsed.limitMinutes === 'number' && parsed.limitMinutes > 0 && parsed.limitMinutes <= 24 * 60
        ? Math.round(parsed.limitMinutes)
        : DEFAULT_LIMIT_MINUTES
    return {
      phase: validPhase,
      limitMinutes,
      sessionStartedAt: typeof parsed.sessionStartedAt === 'number' ? parsed.sessionStartedAt : null,
      challengeTask: typeof parsed.challengeTask === 'string' ? parsed.challengeTask : null,
    }
  } catch {
    return defaultState()
  }
}

function writeLocalScreenTime(next: LocalScreenTimeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  dispatchChanged()
}

export function pickRandomGiftTask(): string {
  const idx = Math.floor(Math.random() * GIFT_CHALLENGE_TASKS.length)
  return GIFT_CHALLENGE_TASKS[idx] ?? GIFT_CHALLENGE_TASKS[0]
}

export function getSessionEndsAt(state: LocalScreenTimeState): number | null {
  if (state.phase !== 'active' || state.sessionStartedAt == null) return null
  return state.sessionStartedAt + state.limitMinutes * 60 * 1000
}

export function isSessionExpired(state: LocalScreenTimeState, now = Date.now()): boolean {
  const ends = getSessionEndsAt(state)
  return ends != null && now >= ends
}

export function getRemainingMs(state: LocalScreenTimeState, now = Date.now()): number | null {
  const ends = getSessionEndsAt(state)
  if (ends == null) return null
  return Math.max(0, ends - now)
}

export function startLocalScreenTimeSession(limitMinutes: number) {
  const mins = Math.min(24 * 60, Math.max(1, Math.round(limitMinutes)))
  writeLocalScreenTime({
    phase: 'active',
    limitMinutes: mins,
    sessionStartedAt: Date.now(),
    challengeTask: null,
  })
}

export function enterGiftChallengePhase() {
  const current = readLocalScreenTime()
  if (current.phase === 'challenge' || current.phase === 'locked') return
  writeLocalScreenTime({
    ...current,
    phase: 'challenge',
    challengeTask: pickRandomGiftTask(),
  })
}

export function completeGiftChallengeAndLock() {
  const current = readLocalScreenTime()
  writeLocalScreenTime({
    ...current,
    phase: 'locked',
    sessionStartedAt: null,
    challengeTask: null,
  })
}

export function clearLocalScreenTimeToIdle() {
  writeLocalScreenTime(defaultState())
}

export function isChildPlaybackBlocked(phase: ScreenTimePhase = readLocalScreenTime().phase): boolean {
  return phase === 'challenge' || phase === 'locked'
}
