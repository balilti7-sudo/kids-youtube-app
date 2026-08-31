import type { ReactNode } from 'react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { SCREEN_TIME_BLOCKING_ENABLED } from '../../lib/parentalLimitsPolicy'
import { ScreenTimeGiftChallengeModal } from './ScreenTimeGiftChallengeModal'
import { ScreenTimeLockedOverlay } from './ScreenTimeLockedOverlay'

type Props = {
  children: ReactNode
}

/**
 * Blocks child playback when server screen-time challenge/lock is active.
 * Uses sessionStorage cache for smooth refresh; server tick is authoritative.
 */
export function ScreenTimeChildGate({ children }: Props) {
  // Screen-time sessions are disabled app-wide — never hide playback for challenge/lock.
  if (!SCREEN_TIME_BLOCKING_ENABLED) {
    return <>{children}</>
  }

  const hasKidToken = Boolean(getSavedChildAccessToken())
  const runtime = useChildRuntimeOptional()

  if (!hasKidToken) {
    return <>{children}</>
  }

  const phase = runtime?.screenTimePhase ?? 'idle'
  const challengeTask = runtime?.challengeTask
  const completeChallengeAndLock = runtime?.completeChallengeAndLock

  return (
    <>
      {phase === 'locked' ? null : children}
      {phase === 'locked' ? <ScreenTimeLockedOverlay /> : null}
      {phase === 'challenge' && challengeTask && completeChallengeAndLock ? (
        <ScreenTimeGiftChallengeModal
          task={challengeTask}
          onChallengeComplete={() => {
            void completeChallengeAndLock()
          }}
        />
      ) : null}
    </>
  )
}
