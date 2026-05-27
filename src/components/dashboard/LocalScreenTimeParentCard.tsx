import { useEffect, useState } from 'react'
import { Clock, Play, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useLocalScreenTime } from '../../hooks/useLocalScreenTime'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { toast } from 'sonner'

function formatRemaining(ms: number | null): string {
  if (ms == null) return '—'
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const PHASE_LABEL: Record<string, string> = {
  idle: 'אין סשן פעיל',
  active: 'סשן צפייה פעיל',
  challenge: 'משימת מתנה (ממתין להורים)',
  locked: 'נעול אחרי משימה',
}

export function LocalScreenTimeParentCard() {
  const kidToken = getSavedChildAccessToken()
  const screenTime = useLocalScreenTime()
  const [minutes, setMinutes] = useState(String(screenTime.limitMinutes))

  useEffect(() => {
    setMinutes(String(screenTime.limitMinutes))
  }, [screenTime.limitMinutes])

  if (!kidToken) return null

  const startSession = () => {
    const parsed = Number(minutes)
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast.error('הזינו מספר דקות תקין (לפחות 1)')
      return
    }
    screenTime.startSession(parsed)
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
          זמן מסך מקומי (מכשיר יחיד)
        </h2>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        הטיימר רץ על המכשיר של הילד. בסיום הזמן תופיע משימה מחוץ למסך; אחרי אישור הורה המכשיר ננעל עד שתפתחו סשן חדש.
      </p>
      <p className="mb-3 text-xs font-semibold text-zinc-500">
        מצב: <span className="text-zinc-300">{PHASE_LABEL[screenTime.phase] ?? screenTime.phase}</span>
        {screenTime.phase === 'active' ? (
          <span className="ms-2 text-sky-300">נותר: {formatRemaining(screenTime.remainingMs)}</span>
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
        <Button type="button" className="w-full shrink-0 justify-center gap-2 sm:w-auto" onClick={startSession}>
          {screenTime.phase === 'locked' || screenTime.phase === 'challenge' ? (
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
