import { useCallback, useEffect, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { Button } from '../ui/Button'
import {
  checkBiometricHardwareAvailable,
  isBiometricUnlockEnabled,
  isBiometricUnlockSupported,
  tryBiometricParentUnlock,
} from '../../lib/parentBiometricUnlock'

type ParentBiometricButtonProps = {
  onPin: (pin: string) => void
  className?: string
  autoPrompt?: boolean
}

export function ParentBiometricButton({
  onPin,
  className,
  autoPrompt = false,
}: ParentBiometricButtonProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!isBiometricUnlockSupported() || !isBiometricUnlockEnabled()) {
        if (!cancelled) setVisible(false)
        return
      }
      const hardware = await checkBiometricHardwareAvailable()
      if (!cancelled) setVisible(hardware)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runBiometric = useCallback(async () => {
    const pin = await tryBiometricParentUnlock()
    if (pin) onPin(pin)
  }, [onPin])

  useEffect(() => {
    if (!autoPrompt || !visible) return
    void runBiometric()
  }, [autoPrompt, visible, runBiometric])

  if (!visible) return null

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      onClick={() => void runBiometric()}
    >
      <Fingerprint className="h-5 w-5" aria-hidden />
      כניסה בטביעת אצבע
    </Button>
  )
}
