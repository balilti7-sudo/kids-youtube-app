import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { ParentSettingsToggle } from './ParentSettingsToggle'

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
    <ParentSettingsToggle
      className={className}
      accent="zinc"
      icon={<ImageOff className="h-5 w-5" />}
      title={t('thumbnails.hideTitle')}
      description={enabled ? t('thumbnails.hintOn') : t('thumbnails.hintOff')}
      checked={enabled}
      disabled={saving}
      onChange={(next) => {
        setEnabled(next)
        void persist(next)
      }}
    />
  )
}
