import { useEffect, useState } from 'react'
import { Clock, Play, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { getChildDeviceState, getSavedChildAccessToken } from '../../lib/childDevice'
import { ChildRuntimeProvider, useChildRuntime } from '../../contexts/ChildRuntimeContext'
import { toast } from 'sonner'

function formatRemaining(seconds: number | null): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'אין סשן פעיל',
  active: 'סשן צפייה פעיל',
  challenge: 'משימת מתנה (ממתין להורים)',
  locked: 'נעול אחרי משימה',
}

function LocalScreenTimeParentCardInner() {
  const screenTime = useChildRuntime()
  const [minutes, setMinutes] = useState(String(screenTime.effectiveRuntime?.screenTimeLimitMinutes ?? 30))
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    const token = getSavedChildAccessToken()
    if (!token) return
    void getChildDeviceState(token).then(({ data }) => {
      if (data?.device_id) setDeviceId(data.device_id)
    })
  }, [])

  useEffect(() => {
    const limit = screenTime.effectiveRuntime?.screenTimeLimitMinutes
    if (limit) setMinutes(String(limit))
  }, [screenTime.effectiveRuntime?.screenTimeLimitMinutes])

  const phase = screenTime.screenTimePhase

  const startSession = async () => {
    const parsed = Number(minutes)
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error('הזינו מספר דקות תקין (לפחות 1)')
      return
    }
    if (!deviceId) {
      toast.error('לא נמצא פרופיל ילד — רעננו את הדף')
      return
    }
    setStarting(true)
    const { error } = await screenTime.startScreenTimeSession(deviceId, parsed)
    setStarting(false)
    if (error) {
      toast.error('שמירה נכשלה', { description: error.message })
      return
    }
    toast.success(`סשן צפייה התחיל — ${Math.round(parsed)} דקות`)
  }

  return (
    <section
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="local-screen-time-title"
    >
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-5 w-5 text-sky-400" aria-hidden />
        <h2 id="local-screen-time-title" className="text-base font-bold text-zinc-50">
          זמן מסך (מאובטח בשרת)
        </h2>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        הטיימר נשמר ב-Supabase לפי שעון השרver. בסיום הזמן תופיע משימה; אחרי אישור הורה המכשיר ננעל עד סשן חדש.
      </p>
      <p className="mb-3 text-xs font-semibold text-zinc-500">
        מצב: <span className="text-zinc-300">{PHASE_LABEL[phase] ?? phase}</span>
        {phase === 'active' ? (
          <span className="ms-2 text-sky-300">נותר: {formatRemaining(screenTime.remainingSeconds)}</span>
        ) : null}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-400">משך סשן (דקות)</span>
          <Input
            type="number"
            min={1}
            max={240}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-full"
          />
        </label>
        <Button
          type="button"
          className="w-full shrink-0 justify-center gap-2 sm:w-auto"
          disabled={starting}
          onClick={() => void startSession()}
        >
          {phase === 'locked' || phase === 'challenge' ? (
            <>
              <RotateCcw className="h-5 w-5" aria-hidden />
              פתח סשן צפייה חדש
            </>
          ) : (
            <>
              <Play className="h-5 w-5" aria-hidden />
              התחל / אפס סשן צפייה
            </>
          )}
        </Button>
      </div>
    </section>
  )
}

export function LocalScreenTimeParentCard() {
  const kidToken = getSavedChildAccessToken()
  if (!kidToken) return null

  return (
    <ChildRuntimeProvider>
      <LocalScreenTimeParentCardInner />
    </ChildRuntimeProvider>
  )
}
