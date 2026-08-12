import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { cn } from '../../lib/utils'

type Props = {
  device: Device
  className?: string
}

export function HideThumbnailsDeviceSettings({ device, className }: Props) {
  const { t } = useTranslation()
  const updateDeviceSettings = useDeviceStore((s) => s.updateDeviceSettings)
  const [enabled, setEnabled] = useState(Boolean(device.hide_thumbnails))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(Boolean(device.hide_thumbnails))
  }, [device.id, device.hide_thumbnails])

  const persist = async (next: boolean) => {
    setSaving(true)
    const { error } = await updateDeviceSettings(device.id, { hideThumbnails: next })
    setSaving(false)
    if (error) {
      toast.error(t('dashboard.saveFailed'), { description: error.message })
      setEnabled(Boolean(device.hide_thumbnails))
      return
    }
    toast.success(next ? t('thumbnails.hiddenOn') : t('thumbnails.hiddenOff'))
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-violet-500/25 bg-violet-950/20 px-3 py-2.5 ring-1 ring-violet-500/10',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-semibold text-zinc-100">{t('thumbnails.hideTitle')}</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={enabled}
              className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-700 transition checked:bg-violet-500 disabled:opacity-50"
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
            {enabled ? t('thumbnails.hintOn') : t('thumbnails.hintOff')}
          </p>
        </div>
      </div>
    </div>
  )
}
