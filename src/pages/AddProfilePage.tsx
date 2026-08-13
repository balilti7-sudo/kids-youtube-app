import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { PageBackBar } from '../components/layout/PageBackBar'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { useSubscription } from '../hooks/useSubscription'
import { useDeviceStore } from '../stores/deviceStore'

/**
 * Minimalist standalone “Add child profile” screen.
 * One job: name + prominent Add Profile CTA.
 */
export function AddProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)

  const [deviceName, setDeviceName] = useState(() => t('dashboard.defaultProfileName'))
  const [saving, setSaving] = useState(false)

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  const handleAdd = async () => {
    const name = deviceName.trim()
    if (!name) {
      toast.error(t('dashboard.enterProfileName'))
      return
    }
    if (!ownerUserId) {
      toast.error(t('dashboard.missingUserId'))
      return
    }
    if (atLimit) {
      toast.error(t('dashboard.limitReached', { count: max }))
      return
    }

    setSaving(true)
    try {
      const { data, error: err } = await addDevice({
        userId: ownerUserId,
        name,
        device_type: 'tablet',
      })
      if (err) {
        console.error('Connection Error:', err)
        toast.error(t('dashboard.saveFailed'), { description: err.message })
        return
      }
      if (data) {
        toast.success(t('dashboard.profileAdded'))
        await refetch()
        navigate(`/dashboard/manage/${encodeURIComponent(data.id)}`, { replace: true })
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error(t('common.error'), { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col pb-10">
      <PageBackBar fallback="/dashboard?skipAdd=1" />

      <div className="flex flex-1 flex-col items-center px-1 pt-6 text-center sm:pt-10">
        <h1 className="max-w-sm text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">
          {t('dashboard.addProfileScreenTitle')}
        </h1>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-zinc-400">
          {t('dashboard.addProfileScreenLead')}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          {t('dashboard.profilesLinked', { count: `${devices.length} / ${max}` })}
        </p>

        {isDevFallback ? (
          <p className="mt-5 w-full rounded-2xl border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-start text-xs leading-relaxed text-amber-100/90">
            <span className="font-semibold text-amber-50">{t('dashboard.devModeLabel')}</span>{' '}
            {t('dashboard.devModeBody')}
          </p>
        ) : null}

        {atLimit ? (
          <div className="mt-10 w-full space-y-4">
            <p className="rounded-2xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
              {t('dashboard.planLimitReached')}
            </p>
            <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/dashboard?skipAdd=1')}>
              {t('common.back')}
            </Button>
          </div>
        ) : (
          <div className="mt-10 w-full max-w-sm space-y-5">
            <div className="text-start">
              <label htmlFor="add-profile-name" className="mb-2 block text-sm font-medium text-zinc-300">
                {t('dashboard.profileName')}
              </label>
              <Input
                id="add-profile-name"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t('dashboard.profileNamePlaceholder')}
                autoFocus
                disabled={saving || !ownerUserId}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAdd()
                }}
                className="rounded-2xl border-zinc-600 bg-zinc-900 text-center text-lg font-semibold"
              />
            </div>

            <Button
              type="button"
              className="flex w-full min-h-14 items-center justify-center gap-2 rounded-2xl !bg-white text-base font-bold !text-zinc-950 shadow-lg shadow-black/30 hover:!bg-zinc-100"
              onClick={() => void handleAdd()}
              disabled={saving || atLimit || !ownerUserId}
            >
              {saving ? (
                <LoadingSpinner className="h-5 w-5 border-2 border-zinc-800 border-t-transparent" />
              ) : (
                <Plus className="h-6 w-6 shrink-0" aria-hidden />
              )}
              {saving ? t('common.saving') : t('dashboard.addProfile')}
            </Button>

            <button
              type="button"
              className="inline-flex min-h-12 w-full items-center justify-center text-sm font-medium text-zinc-500 transition hover:text-zinc-300"
              onClick={() => navigate('/dashboard?skipAdd=1')}
              disabled={saving}
            >
              {t('dashboard.skipAddProfileForNow')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
