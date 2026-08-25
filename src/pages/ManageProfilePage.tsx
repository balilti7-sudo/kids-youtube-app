import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { PageBackBar } from '../components/layout/PageBackBar'
import { ChannelManager } from '../components/channels/ChannelManager'
import { HideThumbnailsDeviceSettings } from '../components/dashboard/HideThumbnailsDeviceSettings'
import { TastePreferenceCard } from '../components/contentTags/TastePreferenceCard'
import { CONTENT_TAGS_ENABLED } from '../config/contentTags'
import { Button } from '../components/ui/Button'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ChildRuntimeProvider } from '../contexts/ChildRuntimeContext'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { clearActiveChildProfileIdIfMatches } from '../lib/activeDeviceSelection'
import { useDeviceStore } from '../stores/deviceStore'
import { cn } from '../lib/utils'

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

  const channelsEmpty = (device.channel_count ?? 0) === 0

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <header className="space-y-1">
        <PageBackBar fallback="/dashboard" flush />
        <h1 className="px-1 text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">{device.name}</h1>
      </header>

      <section aria-label={t('manageProfile.controlsTitle')}>
        <HideThumbnailsDeviceSettings device={device} />
      </section>

      {CONTENT_TAGS_ENABLED ? (
        <section
          className="overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900/90"
          aria-label={t('manageProfile.sectionContent')}
        >
          <div className="px-3.5 py-2">
            <TastePreferenceCard device={device} />
          </div>
        </section>
      ) : null}

      <section
        className={cn(
          channelsEmpty
            ? 'flex flex-col'
            : 'rounded-2xl border border-zinc-700/70 bg-zinc-900/90 p-3 sm:p-4'
        )}
        aria-label={t('manageProfile.channelsTitle')}
      >
        {!channelsEmpty ? (
          <h2 className="mb-2.5 px-0.5 text-sm font-semibold text-zinc-300">
            {t('manageProfile.channelsTitle')}
          </h2>
        ) : null}
        <ChannelManager managedDeviceId={device.id} embedded />
      </section>

      <footer className="flex items-center justify-between gap-3 border-t border-zinc-800/80 pt-3">
        <Button
          type="button"
          variant="secondary"
          className="!min-h-11 rounded-xl px-4 text-sm"
          onClick={() => navigate('/dashboard')}
        >
          {t('common.back')}
        </Button>
        <button
          type="button"
          disabled={deleting}
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-red-400/90 transition hover:bg-red-950/35 hover:text-red-300 disabled:opacity-50"
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
