import { useCallback, useEffect, useState } from 'react'
import {
  completeGiftChallengeAndLock,
  enterGiftChallengePhase,
  getRemainingMs,
  isChildPlaybackBlocked,
  isSessionExpired,
  readLocalScreenTime,
  SCREEN_TIME_CHANGED_EVENT,
  startLocalScreenTimeSession,
  type LocalScreenTimeState,
  type ScreenTimePhase,
} from '../lib/localScreenTime'

export function useLocalScreenTime() {
  const [state, setState] = useState<LocalScreenTimeState>(() => readLocalScreenTime())

  const sync = useCallback(() => {
    setState(readLocalScreenTime())
  }, [])

  useEffect(() => {
    sync()
    const onChange = () => sync()
    window.addEventListener(SCREEN_TIME_CHANGED_EVENT, onChange)
    const id = window.setInterval(() => {
      const current = readLocalScreenTime()
      if (current.phase === 'active' && isSessionExpired(current)) {
        enterGiftChallengePhase()
      }
      sync()
    }, 1000)
    return () => {
      window.removeEventListener(SCREEN_TIME_CHANGED_EVENT, onChange)
      window.clearInterval(id)
    }
  }, [sync])

  const remainingMs = getRemainingMs(state)
  const playbackBlocked = isChildPlaybackBlocked(state.phase)

  return {
    phase: state.phase as ScreenTimePhase,
    limitMinutes: state.limitMinutes,
    challengeTask: state.challengeTask,
    remainingMs,
    playbackBlocked,
    startSession: (limitMinutes: number) => startLocalScreenTimeSession(limitMinutes),
    completeChallengeAndLock: () => completeGiftChallengeAndLock(),
    refresh: sync,
  }
}
