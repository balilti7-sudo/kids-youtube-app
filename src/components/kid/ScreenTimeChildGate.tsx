import type { ReactNode } from 'react'
import { useLocalScreenTime } from '../../hooks/useLocalScreenTime'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { ScreenTimeGiftChallengeModal } from './ScreenTimeGiftChallengeModal'
import { ScreenTimeLockedOverlay } from './ScreenTimeLockedOverlay'

type Props = {
  children: ReactNode
}

/**
 * Blocks child playback when local screen-time challenge/lock is active.
 * Only applies when a child device token is present (single-device kid flow).
 */
export function ScreenTimeChildGate({ children }: Props) {
  const hasKidToken = Boolean(getSavedChildAccessToken())
  const screenTime = useLocalScreenTime()

  if (!hasKidToken) {
    return <>{children}</>
  }

  return (
    <>
      {screenTime.phase === 'locked' ? null : children}
      {screenTime.phase === 'locked' ? <ScreenTimeLockedOverlay /> : null}
      {screenTime.phase === 'challenge' && screenTime.challengeTask ? (
        <ScreenTimeGiftChallengeModal
          task={screenTime.challengeTask}
          onChallengeComplete={screenTime.completeChallengeAndLock}
        />
      ) : null}
    </>
  )
}
