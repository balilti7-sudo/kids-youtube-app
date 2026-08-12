import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Smartphone } from 'lucide-react'
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
 * Phase 1 — standalone “Add child profile” screen.
 * Isolated from channel lists and other parental settings.
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
        // Next step: channel management for the new profile.
        navigate(`/dashboard?manage=${encodeURIComponent(data.id)}`, { replace: true })
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error(t('common.error'), { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 pb-6">
      <PageBackBar fallback="/dashboard?skipAdd=1" />

      <header className="text-center sm:text-start">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30 sm:mx-0">
          <Smartphone className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-xl font-extrabold text-zinc-50 sm:text-2xl">{t('dashboard.addProfileScreenTitle')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">{t('dashboard.addProfileScreenLead')}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {t('dashboard.profilesLinked', { count: `${devices.length} / ${max}` })}
        </p>
      </header>

      {isDevFallback ? (
        <p className="rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
          <span className="font-semibold text-amber-50">{t('dashboard.devModeLabel')}</span> {t('dashboard.devModeBody')}
        </p>
      ) : null}

      {atLimit ? (
        <p className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          {t('dashboard.planLimitReached')}
        </p>
      ) : (
        <section className="rounded-2xl border border-zinc-700/70 bg-zinc-900/90 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5">
          <label htmlFor="add-profile-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
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
            className="mb-4"
          />
          <p className="mb-4 text-xs leading-relaxed text-zinc-500">{t('dashboard.newProfileHint')}</p>
          <Button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl !py-3 text-[15px] font-bold"
            onClick={() => void handleAdd()}
            disabled={saving || atLimit || !ownerUserId}
          >
            {saving ? (
              <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" />
            ) : (
              <Plus className="h-5 w-5 shrink-0" aria-hidden />
            )}
            {saving ? t('common.saving') : t('dashboard.addProfile')}
          </Button>
        </section>
      )}

      {!atLimit ? (
        <button
          type="button"
          className="text-center text-sm font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-300 hover:underline"
          onClick={() => navigate('/dashboard?skipAdd=1')}
          disabled={saving}
        >
          {t('dashboard.skipAddProfileForNow')}
        </button>
      ) : (
        <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/dashboard?skipAdd=1')}>
          {t('common.back')}
        </Button>
      )}
    </div>
  )
}
