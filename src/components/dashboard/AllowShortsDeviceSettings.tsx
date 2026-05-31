import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { cn } from '../../lib/utils'

type Props = {
  device: Device
  className?: string
}

export function AllowShortsDeviceSettings({ device, className }: Props) {
  const updateAllowShorts = useDeviceStore((s) => s.updateAllowShorts)
  const [enabled, setEnabled] = useState(Boolean(device.allow_shorts))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(device.allow_shorts))
  }, [device.id, device.allow_shorts])

  const persist = async (next: boolean) => {
    setSaving(true)
    const { error } = await updateAllowShorts(device.id, next)
    setSaving(false)
    if (error) {
      toast.error('שמירה נכשלה', { description: error.message })
      setEnabled(Boolean(device.allow_shorts))
      return
    }
    toast.success(next ? 'Shorts מותרים בפרופיל הזה' : 'Shorts חסומים בפרופיל הזה')
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-sky-500/25 bg-sky-950/20 px-3 py-2.5 ring-1 ring-sky-500/10',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-semibold text-zinc-100">אפשר צפייה בסרטוני Shorts 📱</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={enabled}
              className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-700 transition checked:bg-sky-500 disabled:opacity-50"
              style={{
                backgroundImage: enabled
                  ? 'radial-gradient(circle at 1.35rem center, white 0.55rem, transparent 0.56rem)'
                  : 'radial-gradient(circle at 0.35rem center, white 0.55rem, transparent 0.56rem)',
              }}
              checked={enabled}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.checked
                setEnabled(next)
                void persist(next)
              }}
            />
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
            {enabled
              ? 'הילד יכול לראות גם סרטונים קצרים (עד 60 שניות ו-/shorts/).'
              : 'סרטונים קצרים מ-60 שניות וקישורי /shorts/ יוסתרו מהילד.'}
          </p>
        </div>
      </div>
    </div>
  )
}
