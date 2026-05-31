import { useCallback, useEffect, useState } from 'react'
import { Moon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/Button'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import { useAuth } from '../../hooks/useAuth'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { readLocalParentSession } from '../../lib/localParentAdmin'
import { pinsMatch } from '../../lib/parentPin'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { useChildRuntime } from '../../contexts/ChildRuntimeContext'
import type { ParentBedtimeState } from '../../lib/childRuntime'
import { cn } from '../../lib/utils'

type Props = {
  deviceId: string
  className?: string
}

export function BedtimeParentApproveControl({ deviceId, className }: Props) {
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const runtime = useChildRuntime()
  const [state, setState] = useState<ParentBedtimeState | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const localPin = readLocalParentSession()?.pin?.trim() ?? ''
  const usePinFlow = localPin.length >= 4

  const verifyParentPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin ?? localPin },
        },
        pin
      ),
    [user?.id, profile, localParent.isActive, localParent.pin, localPin]
  )

  const loadState = useCallback(async () => {
    setLoading(true)
    const { data, error } = await runtime.parentGetBedtimeState(deviceId)
    setLoading(false)
    if (error) {
      console.warn('[BedtimeParentApprove] load failed', error.message)
      return
    }
    setState(data)
  }, [deviceId, runtime])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const runApprove = async () => {
    setApproving(true)
    const { error } = await runtime.parentApproveBedtime(deviceId)
    setApproving(false)
    if (error) {
      toast.error('אישור נכשל', { description: error.message })
      return
    }
    toast.success('שגרת השינה אושרה! הילד יכול לסובב את הגלגל 🎡')
    void loadState()
  }

  if (loading && !state) return null
  if (!state?.enabled) return null

  const canApprove = state.tasksCompleted && !state.parentApproved && !state.wheelSpun

  if (!canApprove) {
    if (state.parentApproved && !state.wheelSpun) {
      return (
        <p className={cn('text-xs leading-snug text-emerald-400/90', className)}>
          שגרת שינה: אושר — הילד יכול לסובב את הגלגל.
        </p>
      )
    }
    if (state.wheelSpun) {
      return (
        <p className={cn('text-xs leading-snug text-zinc-500', className)}>
          שגרת שינה: הערב הושלם להיום.
        </p>
      )
    }
    return (
      <p className={cn('text-xs leading-snug text-zinc-500', className)}>
        שגרת שינה: ממתינים שהילד יסמן את משימות הערב.
      </p>
    )
  }

  return (
    <>
      <div
        className={cn(
          'rounded-xl border border-indigo-500/25 bg-indigo-950/20 px-3 py-2.5 ring-1 ring-indigo-500/10',
          className
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-xs text-indigo-200/90">
          <Moon className="h-3.5 w-3.5 shrink-0 text-indigo-300" aria-hidden />
          הילד סיים את משימות הערב ומחכה לאישור שלכם.
        </div>
        <Button
          type="button"
          className="w-full justify-center gap-2 py-2.5 text-sm font-bold"
          disabled={approving}
          onClick={() => {
            if (usePinFlow) {
              setPinOpen(true)
              return
            }
            void runApprove()
          }}
        >
          {approving ? 'מאשר…' : 'אשר שגרת שינה לילד 🔑'}
        </Button>
      </div>

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        verifyPin={async (pin) => {
          if (localPin && pinsMatch(pin, localPin)) return { ok: true as const }
          return verifyParentPin(pin)
        }}
        onVerified={() => {
          setPinOpen(false)
          void runApprove()
        }}
        title="אימות הורה — שגרת שינה"
        description="הזינו את קוד ההורה כדי לאשר שהילד סיים את משימות הערב."
      />
    </>
  )
}
