import { useCallback, useEffect, useState } from 'react'
import { Moon, Timer } from 'lucide-react'
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
import { notifyBedtimeChanged } from '../../lib/childRuntime'
import { normalizeGracePeriodMinutes } from '../../lib/bedtimeRoutinePhase'
import { BedtimeGoodnightOverlay } from '../kid/BedtimeGoodnightOverlay'
import { cn } from '../../lib/utils'

const GRACE_MINUTE_OPTIONS = [3, 5, 10, 15, 20, 30] as const

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
  const [startingGrace, setStartingGrace] = useState(false)
  const [savingGraceMinutes, setSavingGraceMinutes] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [gracePinOpen, setGracePinOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

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
    notifyBedtimeChanged()
    void loadState()
  }

  const runStartGrace = async () => {
    setStartingGrace(true)
    const { error } = await runtime.parentStartBedtimeGrace(deviceId, state?.routineDate ?? null)
    setStartingGrace(false)
    if (error) {
      toast.error('התחלת הטיימר נכשלה', { description: error.message })
      return
    }
    toast.success('הטיימר לפני שגרת השינה התחיל ⏱️')
    notifyBedtimeChanged()
    void loadState()
  }

  const saveGraceMinutes = async (minutes: number) => {
    setSavingGraceMinutes(true)
    const { error } = await runtime.parentUpdateBedtimeSettings(deviceId, {
      gracePeriodMinutes: minutes,
    })
    setSavingGraceMinutes(false)
    if (error) {
      toast.error('שמירת זמן החסד נכשלה', { description: error.message })
      return
    }
    toast.success(`זמן חסד לפני שגרה: ${minutes} דקות`)
    void loadState()
  }

  if (loading && !state) return null
  if (!state?.enabled) return null

  const graceMinutes = normalizeGracePeriodMinutes(state.gracePeriodMinutes)
  const graceNotStarted = !state.graceCountdownStartedAt
  const canApprove = state.tasksCompleted && !state.parentApproved && !state.wheelSpun

  const previewButton = (
    <Button
      type="button"
      variant="secondary"
      className="mt-2 w-full justify-center gap-2 py-2 text-xs font-bold"
      onClick={() => setPreviewOpen(true)}
    >
      תצוגה מקדימה — לילה טוב 🌙
    </Button>
  )

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
          שגרת שינה פעילה להיום
        </div>

        <label className="mb-1 block text-[11px] font-semibold text-zinc-400">
          דקות חסד לפני נעילה (הורה מתחיל ידנית)
        </label>
        <select
          className="mb-2 w-full rounded-lg border border-zinc-600/50 bg-zinc-900/80 px-2 py-1.5 text-xs text-zinc-100"
          value={graceMinutes}
          disabled={savingGraceMinutes}
          onChange={(e) => void saveGraceMinutes(Number(e.target.value))}
        >
          {GRACE_MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} דקות
            </option>
          ))}
        </select>

        {graceNotStarted && !state.wheelSpun ? (
          <Button
            type="button"
            variant="secondary"
            className="mb-2 w-full justify-center gap-2 py-2.5 text-sm font-bold"
            disabled={startingGrace}
            onClick={() => {
              if (usePinFlow) {
                setGracePinOpen(true)
                return
              }
              void runStartGrace()
            }}
          >
            <Timer className="h-4 w-4 shrink-0" aria-hidden />
            {startingGrace ? 'מתחיל…' : `התחל טיימר (${graceMinutes} דק׳)`}
          </Button>
        ) : state.graceCountdownStartedAt && !state.wheelSpun ? (
          <p className="mb-2 text-xs leading-snug text-amber-200/90">
            הטיימר כבר התחיל — הילד יכול עדיין לצפות עד סיום {graceMinutes} הדקות.
          </p>
        ) : null}

        {canApprove ? (
          <>
            <p className="mb-2 text-xs leading-snug text-indigo-200/80">
              הילד סיים משימות — אשרו לפני סיבוב הגלגל.
            </p>
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
          </>
        ) : state.parentApproved && !state.wheelSpun ? (
          <p className="text-xs leading-snug text-emerald-400/90">
            אושר — הילד יכול לסובב את הגלגל.
          </p>
        ) : state.wheelSpun ? (
          <p className="text-xs leading-snug text-zinc-500">הערב הושלם להיום.</p>
        ) : (
          <p className="text-xs leading-snug text-zinc-500">ממתינים שהילד יסמן משימות ערב.</p>
        )}

        {previewButton}
      </div>

      <BedtimeGoodnightOverlay open={previewOpen} onClose={() => setPreviewOpen(false)} preview />

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

      <ParentalPinModal
        open={gracePinOpen}
        onClose={() => setGracePinOpen(false)}
        verifyPin={async (pin) => {
          if (localPin && pinsMatch(pin, localPin)) return { ok: true as const }
          return verifyParentPin(pin)
        }}
        onVerified={() => {
          setGracePinOpen(false)
          void runStartGrace()
        }}
        title="התחלת טיימר שגרת שינה"
        description={`הזינו קוד PIN כדי להתחיל ${graceMinutes} דקות חסד לפני שגרת השינה.`}
      />
    </>
  )
}
