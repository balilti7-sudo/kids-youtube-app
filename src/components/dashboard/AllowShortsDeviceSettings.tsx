import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { ParentSettingsToggle } from './ParentSettingsToggle'

type Props = {
  device: Device
  className?: string
  /** Render row-only (no card chrome) when nested inside a settings group. */
  card?: boolean
}

export function AllowShortsDeviceSettings({ device, className, card }: Props) {
  const { t } = useTranslation()
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
      toast.error(t('dashboard.saveFailed'), { description: error.message })
      setEnabled(Boolean(device.allow_shorts))
      return
    }
    toast.success(next ? t('shorts.allowOn') : t('shorts.allowOff'))
  }

  return (
    <ParentSettingsToggle
      className={className}
      card={card}
      accent="sky"
      icon={<Smartphone className="h-5 w-5" />}
      title={t('shorts.allowTitle')}
      description={enabled ? t('shorts.hintOn') : t('shorts.hintOff')}
      checked={enabled}
      disabled={saving}
      onChange={(next) => {
        setEnabled(next)
        void persist(next)
      }}
    />
  )
}
