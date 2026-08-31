import type { ReactNode } from 'react'
import { ForcedUpdateOverlay } from './ForcedUpdateOverlay'
import { useAppUpdateGate } from '../../hooks/useAppUpdateGate'

type Props = {
  children: ReactNode
}

/**
 * Version check on launch/resume.
 * Soft: app stays usable under a dismissible dialog.
 * Hard: entire app is unmounted (WhatsApp-style) until the user updates.
 */
export function AppUpdateGate({ children }: Props) {
  const { visible, skipSoftUpdate, hardLocked } = useAppUpdateGate()

  if (hardLocked && visible.kind === 'hard') {
    return <ForcedUpdateOverlay gate={visible.state} />
  }

  return (
    <>
      {children}
      {visible.kind === 'soft' ? (
        <ForcedUpdateOverlay gate={visible.state} onSkip={skipSoftUpdate} />
      ) : null}
    </>
  )
}
