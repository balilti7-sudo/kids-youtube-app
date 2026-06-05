import { useCallback, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { notifyBedtimeChanged } from '../../lib/childRuntime'
import { useParentManagementPinVerify } from '../../hooks/useParentManagementPinVerify'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type Props = {
  className?: string
  /** Compact label for passive banner */
  compact?: boolean
}

/** Parent PIN → starts server-side grace countdown (no auto timer before this). */
export function BedtimeRoutineParentStartButton({ className, compact = false }: Props) {
  const runtime = useChildRuntimeOptional()
  const deviceId = runtime?.activeDeviceId ?? null
  const verifyParentPin = useParentManagementPinVerify()
  const [pinOpen, setPinOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleVerified = useCallback(async () => {
    if (!deviceId || !runtime?.parentStartBedtimeGrace) {
      setError('לא ניתן להתחיל — נא לרענן את הדף.')
      return
    }
    setBusy(true)
    setError(null)
    const routineDate = runtime.bedtimeState?.routineDate ?? null
    const { error: rpcError } = await runtime.parentStartBedtimeGrace(deviceId, routineDate)
    setBusy(false)
    if (rpcError) {
      const msg = rpcError.message
      setError(
        /parent_start_bedtime_grace|42883|does not exist/i.test(msg)
          ? 'הריצו ב-Supabase את מיגרציה 054 (parent_start_bedtime_grace).'
          : msg
      )
      return
    }
    setPinOpen(false)
    await runtime.refreshBedtimeState?.()
    notifyBedtimeChanged()
  }, [deviceId, runtime])

  return (
    <>
      <Button
        type="button"
        className={cn('gap-2 font-bold', className)}
        disabled={busy}
        onClick={() => setPinOpen(true)}
      >
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        {compact ? 'התחלת שגרה (קוד הורה)' : 'התחלת טיימר שגרת שינה (קוד הורה)'}
      </Button>
      {error ? (
        <p className="mt-2 text-center text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onVerified={() => void handleVerified()}
        verifyPin={verifyParentPin}
        title="התחלת שגרת השינה"
        description="הזינו את קוד ההורה כדי להתחיל את זמן החסד לפני שגרת השינה. עד אז הילד יכול להמשיך לצפות."
      />
    </>
  )
}
