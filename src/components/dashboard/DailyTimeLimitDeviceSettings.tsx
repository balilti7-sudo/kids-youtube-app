import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const PRESETS = [30, 45, 60, 90, 120] as const

type Props = {
  device: Device
  className?: string
}

function normalizeLimit(raw: unknown): number {
  const n = Number(raw ?? 60)
  if (!Number.isFinite(n)) return 60
  const rounded = Math.round(n)
  if (rounded === 0) return 0
  if (rounded < 1) return 60
  return Math.min(1440, rounded)
}

function formatLimitLabel(minutes: number): string {
  if (minutes === 0) return 'ללא הגבלה'
  if (minutes < 60) return `${minutes} דק׳`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return h === 1 ? 'שעה' : `${h} שעות`
  return `${h}:${String(m).padStart(2, '0')} ש׳`
}

export function DailyTimeLimitDeviceSettings({ device, className }: Props) {
  const updateDeviceSettings = useDeviceStore((s) => s.updateDeviceSettings)
  const [limit, setLimit] = useState(() => normalizeLimit(device.daily_time_limit_minutes))
  const [customDraft, setCustomDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next = normalizeLimit(device.daily_time_limit_minutes)
    setLimit(next)
    if (!PRESETS.includes(next as (typeof PRESETS)[number]) && next !== 0) {
      setCustomDraft(String(next))
    } else {
      setCustomDraft('')
    }
  }, [device.id, device.daily_time_limit_minutes])

  const persist = async (next: number) => {
    const normalized = normalizeLimit(next)
    setSaving(true)
    setLimit(normalized)
    const { error } = await updateDeviceSettings(device.id, {
      dailyTimeLimitMinutes: normalized,
    })
    setSaving(false)
    if (error) {
      toast.error('שמירה נכשלה', { description: error.message })
      setLimit(normalizeLimit(device.daily_time_limit_minutes))
      return
    }
    toast.success(
      normalized === 0
        ? 'מגבלת הזמן בוטלה — צפייה ללא הגבלה יומית'
        : `מגבלת הצפייה היומית: ${formatLimitLabel(normalized)}`
    )
  }

  const applyCustom = () => {
    const parsed = Number(customDraft.trim())
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
      toast.error('הזינו מספר בין 1 ל־1440 דקות')
      return
    }
    void persist(Math.round(parsed))
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2.5 ring-1 ring-amber-500/10',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100">מגבלת זמן יומית</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            כמה דקות צפייה מותרות לפרופיל הזה בכל יום (מתאפס בחצות שעון ישראל).
            כרגע: <span className="font-medium text-zinc-200">{formatLimitLabel(limit)}</span>
          </p>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={saving}
                onClick={() => void persist(m)}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                  limit === m
                    ? 'bg-amber-500 text-zinc-950'
                    : 'bg-zinc-800/90 text-zinc-200 ring-1 ring-zinc-700/80 hover:bg-zinc-700'
                )}
              >
                {formatLimitLabel(m)}
              </button>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={() => void persist(0)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition',
                limit === 0
                  ? 'bg-amber-500 text-zinc-950'
                  : 'bg-zinc-800/90 text-zinc-200 ring-1 ring-zinc-700/80 hover:bg-zinc-700'
              )}
            >
              ללא הגבלה
            </button>
          </div>

          <div className="mt-2.5 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[11px] font-medium text-zinc-500" htmlFor={`custom-limit-${device.id}`}>
                מותאם אישית (דקות)
              </label>
              <Input
                id={`custom-limit-${device.id}`}
                inputMode="numeric"
                type="number"
                min={1}
                max={1440}
                placeholder="למשל 75"
                value={customDraft}
                disabled={saving}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyCustom()
                }}
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-9 shrink-0 !px-3 text-xs"
              disabled={saving || !customDraft.trim()}
              onClick={applyCustom}
            >
              שמור
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
