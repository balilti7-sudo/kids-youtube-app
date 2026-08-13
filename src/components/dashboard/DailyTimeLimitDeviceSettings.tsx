import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
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

function formatLimitLabel(minutes: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (minutes === 0) return t('timeLimit.unlimited')
  if (minutes < 60) return t('timeLimit.minutesAbbr', { count: minutes })
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return t('timeLimit.hoursAbbr', { count: h })
  return t('timeLimit.hoursMinutesAbbr', { hours: h, minutes: m })
}

export function DailyTimeLimitDeviceSettings({ device, className }: Props) {
  const { t } = useTranslation()
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
      toast.error(t('dashboard.saveFailed'), { description: error.message })
      setLimit(normalizeLimit(device.daily_time_limit_minutes))
      return
    }
    toast.success(
      normalized === 0
        ? t('timeLimit.savedUnlimited')
        : t('timeLimit.savedLimited', { label: formatLimitLabel(normalized, t) })
    )
  }

  const applyCustom = () => {
    const parsed = Number(customDraft.trim())
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
      toast.error(t('timeLimit.invalidMinutes'))
      return
    }
    void persist(Math.round(parsed))
  }

  const chipClass = (active: boolean) =>
    cn(
      'inline-flex min-h-12 min-w-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition',
      active
        ? 'bg-amber-400 text-zinc-950 shadow-md shadow-amber-900/30'
        : 'bg-zinc-800/90 text-zinc-100 ring-1 ring-zinc-700/80 hover:bg-zinc-700'
    )

  return (
    <div
      className={cn(
        'rounded-2xl border border-amber-500/30 bg-amber-950/20 px-4 py-4 ring-1 ring-amber-500/15',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25 text-amber-300"
          aria-hidden
        >
          <Clock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-zinc-50">{t('timeLimit.title')}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
            {t('timeLimit.presetsHint')}{' '}
            {t('timeLimit.current', { status: formatLimitLabel(limit, t) })}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={saving}
                onClick={() => void persist(m)}
                className={chipClass(limit === m)}
              >
                {formatLimitLabel(m, t)}
              </button>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={() => void persist(0)}
              className={chipClass(limit === 0)}
            >
              {t('timeLimit.unlimited')}
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1.5 block text-xs font-medium text-zinc-500" htmlFor={`custom-limit-${device.id}`}>
                {t('timeLimit.customMinutes')}
              </label>
              <Input
                id={`custom-limit-${device.id}`}
                inputMode="numeric"
                type="number"
                min={1}
                max={1440}
                placeholder={t('timeLimit.customPlaceholder')}
                value={customDraft}
                disabled={saving}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyCustom()
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="w-full shrink-0 sm:w-auto"
              disabled={saving || !customDraft.trim()}
              onClick={applyCustom}
            >
              {t('timeLimit.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
