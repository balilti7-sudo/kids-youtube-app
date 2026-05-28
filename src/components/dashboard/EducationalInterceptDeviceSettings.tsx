import { useEffect, useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { toast } from 'sonner'
import { INTERCEPT_FREQUENCY_OPTIONS } from '../../data/educationalScenes'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device, EducationalInterceptFrequency } from '../../types'
import { cn } from '../../lib/utils'

type Props = {
  device: Device
  className?: string
}

export function EducationalInterceptDeviceSettings({ device, className }: Props) {
  const updateSettings = useDeviceStore((s) => s.updateEducationalInterceptSettings)
  const [enabled, setEnabled] = useState(Boolean(device.educational_intercepts_enabled))
  const [frequency, setFrequency] = useState<EducationalInterceptFrequency>(
    device.educational_intercept_frequency === 2 || device.educational_intercept_frequency === 5
      ? device.educational_intercept_frequency
      : 3
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(device.educational_intercepts_enabled))
    setFrequency(
      device.educational_intercept_frequency === 2 || device.educational_intercept_frequency === 5
        ? device.educational_intercept_frequency
        : 3
    )
  }, [device.id, device.educational_intercepts_enabled, device.educational_intercept_frequency])

  const persist = async (nextEnabled: boolean, nextFrequency: EducationalInterceptFrequency) => {
    setSaving(true)
    const { error } = await updateSettings(device.id, nextEnabled, nextFrequency)
    setSaving(false)
    if (error) {
      toast.error('שמירה נכשלה', { description: error.message })
      setEnabled(Boolean(device.educational_intercepts_enabled))
      setFrequency(
        device.educational_intercept_frequency === 2 || device.educational_intercept_frequency === 5
          ? device.educational_intercept_frequency
          : 3
      )
      return
    }
    toast.success('הפסקות חינוכיות עודכנו')
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-violet-500/25 bg-violet-950/20 px-3 py-2.5 ring-1 ring-violet-500/10',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-semibold text-zinc-100">הפסקות חינוכיות</span>
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-violet-500 focus:ring-violet-400"
              checked={enabled}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.checked
                setEnabled(next)
                void persist(next, frequency)
              }}
            />
          </label>
          {enabled ? (
            <div className="mt-2">
              <label htmlFor={`intercept-freq-${device.id}`} className="mb-1 block text-xs text-zinc-400">
                תדירות
              </label>
              <select
                id={`intercept-freq-${device.id}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                value={frequency}
                disabled={saving}
                onChange={(e) => {
                  const next = Number(e.target.value) as EducationalInterceptFrequency
                  setFrequency(next)
                  void persist(enabled, next)
                }}
              >
                {INTERCEPT_FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-1 text-xs leading-snug text-zinc-500">גור האריה יבקש הפסקה לסידור החדר בין סרטונים.</p>
          )}
        </div>
      </div>
    </div>
  )
}
