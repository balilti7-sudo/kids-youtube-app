import { useCallback, useState } from 'react'
import { LogOut, ShieldCheck, SkipForward } from 'lucide-react'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import { useParentManagementPinVerify } from '../../hooks/useParentManagementPinVerify'
import { useBedtimeRoutineStore } from '../../stores/bedtimeRoutineStore'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type PinFlow = 'dismiss' | 'approve' | null

type Props = {
  className?: string
  /** Sticky footer on full-screen routine; inline row inside the zone card. */
  variant?: 'footer' | 'inline'
  /** Show parent-approve flow when tasks are done but wheel is locked. */
  showParentApprove?: boolean
}

/**
 * Always-available escape hatches: parent PIN to approve the wheel or skip/dismiss the routine.
 * Works during countdown deferral, parent-wait, and full-screen lock.
 */
export function BedtimeRoutineEmergencyExit({
  className,
  variant = 'footer',
  showParentApprove = false,
}: Props) {
  const runtime = useChildRuntimeOptional()
  const bedtime = runtime?.bedtimeState
  const deviceId = runtime?.activeDeviceId ?? null
  const dismissRoutineWithParentPin = useBedtimeRoutineStore((s) => s.dismissRoutineWithParentPin)
  const verifyParentPin = useParentManagementPinVerify()

  const [pinFlow, setPinFlow] = useState<PinFlow>(null)
  const [approveBusy, setApproveBusy] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const closePin = useCallback(() => {
    setPinFlow(null)
    setApproveError(null)
  }, [])

  const handleDismissVerified = useCallback(() => {
    if (!deviceId || !bedtime?.routineDate) return
    dismissRoutineWithParentPin(deviceId, bedtime.routineDate)
    closePin()
  }, [deviceId, bedtime?.routineDate, dismissRoutineWithParentPin, closePin])

  const handleApproveVerified = useCallback(async () => {
    if (!deviceId || !runtime?.parentApproveBedtime) {
      setApproveError('לא ניתן לאשר — נא לרענן את הדף.')
      return
    }
    setApproveBusy(true)
    setApproveError(null)
    const { error } = await runtime.parentApproveBedtime(deviceId, bedtime?.routineDate ?? null)
    setApproveBusy(false)
    if (error) {
      setApproveError(error.message)
      return
    }
    closePin()
  }, [deviceId, runtime, bedtime?.routineDate, closePin])

  const pinOpen = pinFlow !== null
  const pinTitle =
    pinFlow === 'approve' ? 'אישור הורה לגלגל' : 'דילוג על שגרת השינה'
  const pinDescription =
    pinFlow === 'approve'
      ? 'הזינו את קוד ההורה כדי לאשר שהילד סיים את המשימות ויכול לסובב את הגלגל.'
      : 'הזינו את קוד ההורה כדי לצאת משגרת השינה ולהמשיך לצפות (עד מחר בערב).'

  const buttons = (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-2',
        variant === 'footer' && 'gap-3',
        className
      )}
    >
      {showParentApprove ? (
        <Button
          type="button"
          className={cn(
            'gap-2 font-bold',
            variant === 'footer' && 'min-h-11 px-5'
          )}
          disabled={approveBusy}
          onClick={() => setPinFlow('approve')}
        >
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          אישור הורה (קוד PIN)
        </Button>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className={cn(
          'gap-2 font-bold',
          variant === 'footer' && 'min-h-11 px-5'
        )}
        onClick={() => setPinFlow('dismiss')}
      >
        <SkipForward className="h-4 w-4 shrink-0" aria-hidden />
        דלג / סגור
      </Button>
    </div>
  )

  return (
    <>
      {variant === 'footer' ? (
        <div
          className={cn(
            'pointer-events-auto fixed inset-x-0 bottom-0 z-[300] border-t border-indigo-400/25 bg-indigo-950/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md',
            className
          )}
          dir="rtl"
        >
          <p className="mb-2 text-center text-xs font-medium text-indigo-200/80">
            <LogOut className="mb-0.5 inline h-3.5 w-3.5" aria-hidden /> נדרש קוד הורה ליציאה או לאישור
          </p>
          {buttons}
          {approveError ? (
            <p className="mt-2 text-center text-sm text-rose-300" role="alert">
              {approveError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className={cn('mt-3', className)} dir="rtl">
          {buttons}
          {approveError ? (
            <p className="mt-2 text-center text-sm text-rose-300" role="alert">
              {approveError}
            </p>
          ) : null}
        </div>
      )}

      <ParentalPinModal
        open={pinOpen}
        onClose={closePin}
        onVerified={() => {
          if (pinFlow === 'approve') {
            void handleApproveVerified()
            return
          }
          handleDismissVerified()
        }}
        verifyPin={verifyParentPin}
        title={pinTitle}
        description={pinDescription}
      />
    </>
  )
}
