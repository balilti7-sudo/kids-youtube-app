import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Settings2 } from 'lucide-react'
import { PageBackBar } from '../components/layout/PageBackBar'
import { ChannelManager } from '../components/channels/ChannelManager'
import { AllowShortsDeviceSettings } from '../components/dashboard/AllowShortsDeviceSettings'
import { DailyTimeLimitDeviceSettings } from '../components/dashboard/DailyTimeLimitDeviceSettings'
import { DeviceOsControlsSettings } from '../components/dashboard/DeviceOsControlsSettings'
import { HideThumbnailsDeviceSettings } from '../components/dashboard/HideThumbnailsDeviceSettings'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ChildRuntimeProvider } from '../contexts/ChildRuntimeContext'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { clearActiveChildProfileIdIfMatches } from '../lib/activeDeviceSelection'
import { useDeviceStore } from '../stores/deviceStore'

/**
 * Phase 2 — unified Channel Management & Parental Controls for one child profile.
 */
function ManageProfilePageInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { deviceId = '' } = useParams<{ deviceId: string }>()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading, refetch } = useDevices(ownerUserId)
  const removeDevice = useDeviceStore((s) => s.removeDevice)
  const [deleting, setDeleting] = useState(false)

  const device = devices.find((d) => d.id === deviceId) ?? null

  useEffect(() => {
    if (!ownerUserId) return
    void refetch()
  }, [ownerUserId, deviceId, refetch])

  if (loading && !device) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner className="h-8 w-8 border-2 border-sky-400 border-t-transparent" />
      </div>
    )
  }

  if (!loading && !device) {
    return <Navigate to="/dashboard" replace />
  }

  if (!device) return null

  const handleDelete = async () => {
    if (deleting) return
    const confirmed = window.confirm(t('dashboard.deleteProfileConfirm'))
    if (!confirmed) return

    setDeleting(true)
    const { error } = await removeDevice(device.id)
    setDeleting(false)

    if (error) {
      toast.error(t('dashboard.deleteFailed'), { description: error.message })
      return
    }

    clearActiveChildProfileIdIfMatches(device.id)
    toast.success(t('dashboard.profileRemoved'))
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-8">
      <PageBackBar fallback="/dashboard" />

      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sky-300">
          <Settings2 className="h-5 w-5 shrink-0" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide">{t('manageProfile.eyebrow')}</p>
        </div>
        <h1 className="text-xl font-extrabold text-zinc-50 sm:text-2xl">
          {t('manageProfile.title', { name: device.name })}
        </h1>
        <p className="text-sm leading-relaxed text-zinc-400">{t('manageProfile.lead')}</p>
      </header>

      <section
        className="flex flex-col gap-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-3 shadow-inner ring-1 ring-zinc-800/80 sm:p-4"
        aria-labelledby="manage-controls-title"
      >
        <h2 id="manage-controls-title" className="text-base font-bold text-zinc-50">
          {t('manageProfile.controlsTitle')}
        </h2>
        <AllowShortsDeviceSettings device={device} />
        <HideThumbnailsDeviceSettings device={device} />
        <DeviceOsControlsSettings device={device} />
        <DailyTimeLimitDeviceSettings device={device} />
      </section>

      <section
        className="rounded-2xl border border-zinc-700/60 bg-zinc-900/70 p-3 shadow-inner ring-1 ring-zinc-800/80 sm:p-4"
        aria-labelledby="manage-channels-title"
      >
        <h2 id="manage-channels-title" className="mb-3 text-base font-bold text-zinc-50">
          {t('manageProfile.channelsTitle')}
        </h2>
        <p className="mb-3 text-xs text-zinc-500">{t('manageProfile.channelsLead')}</p>
        <ChannelManager managedDeviceId={device.id} embedded />
      </section>

      <footer className="flex justify-end border-t border-zinc-800/90 pt-3">
        <button
          type="button"
          disabled={deleting}
          className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
          onClick={() => void handleDelete()}
        >
          {deleting ? t('common.loading') : t('dashboard.deleteProfile')}
        </button>
      </footer>
    </div>
  )
}

export function ManageProfilePage() {
  return (
    <ChildRuntimeProvider>
      <ManageProfilePageInner />
    </ChildRuntimeProvider>
  )
}
