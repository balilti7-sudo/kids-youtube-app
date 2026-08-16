import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Settings2, ShieldBan, Timer, Tv } from 'lucide-react'
import { PageBackBar } from '../components/layout/PageBackBar'
import { ChannelManager } from '../components/channels/ChannelManager'
import { AllowShortsDeviceSettings } from '../components/dashboard/AllowShortsDeviceSettings'
import { DailyTimeLimitDeviceSettings } from '../components/dashboard/DailyTimeLimitDeviceSettings'
import { DeviceOsControlsSettings } from '../components/dashboard/DeviceOsControlsSettings'
import { HideThumbnailsDeviceSettings } from '../components/dashboard/HideThumbnailsDeviceSettings'
import { SettingsGroupSection } from '../components/dashboard/SettingsGroupSection'
import { Button } from '../components/ui/Button'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ChildRuntimeProvider } from '../contexts/ChildRuntimeContext'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { clearActiveChildProfileIdIfMatches } from '../lib/activeDeviceSelection'
import { useDeviceStore } from '../stores/deviceStore'

/**
 * Unified Channel Management & Parental Controls — scannable Material-style cards.
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-10">
      <PageBackBar fallback="/dashboard" />

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1.5 text-sky-300 ring-1 ring-sky-500/25">
          <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide">{t('manageProfile.eyebrow')}</p>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-zinc-50 sm:text-3xl">
          {t('manageProfile.title', { name: device.name })}
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-zinc-400">{t('manageProfile.lead')}</p>
      </header>

      <section className="space-y-3" aria-labelledby="manage-controls-title">
        <h2 id="manage-controls-title" className="px-0.5 text-lg font-bold text-zinc-50">
          {t('manageProfile.controlsTitle')}
        </h2>
        <div className="flex flex-col gap-3">
          <SettingsGroupSection
            title={t('manageProfile.sectionContent')}
            summary={[
              device.allow_shorts ? t('shorts.allowOn') : t('shorts.allowOff'),
              device.hide_thumbnails
                ? t('thumbnails.summaryHidden')
                : t('thumbnails.summaryShown'),
            ].join(' · ')}
            icon={<Clapperboard className="h-5 w-5" />}
            defaultOpen
          >
            <AllowShortsDeviceSettings device={device} card={false} />
            <div className="border-t border-zinc-800/80" aria-hidden />
            <HideThumbnailsDeviceSettings device={device} card={false} />
          </SettingsGroupSection>

          <SettingsGroupSection
            title={t('manageProfile.sectionScreenTime')}
            summary={
              device.daily_time_limit_minutes
                ? t('timeLimit.minutesAbbr', { count: device.daily_time_limit_minutes })
                : t('timeLimit.unlimited')
            }
            icon={<Timer className="h-5 w-5" />}
          >
            <DailyTimeLimitDeviceSettings device={device} />
          </SettingsGroupSection>

          <SettingsGroupSection
            title={t('manageProfile.sectionProtections')}
            summary={[
              device.block_youtube_app
                ? t('parentalOs.summaryYoutubeOn')
                : t('parentalOs.summaryYoutubeOff'),
              device.browser_filter_enabled
                ? t('parentalOs.summaryBrowserOn')
                : t('parentalOs.summaryBrowserOff'),
            ].join(' · ')}
            icon={<ShieldBan className="h-5 w-5" />}
          >
            <DeviceOsControlsSettings device={device} />
          </SettingsGroupSection>
        </div>
      </section>

      <section
        className="rounded-2xl border border-zinc-600/70 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/70 sm:p-5"
        aria-labelledby="manage-channels-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300"
            aria-hidden
          >
            <Tv className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="manage-channels-title" className="text-lg font-bold text-zinc-50">
              {t('manageProfile.channelsTitle')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t('manageProfile.channelsLead')}</p>
          </div>
        </div>
        <ChannelManager managedDeviceId={device.id} embedded />
      </section>

      <footer className="flex flex-col gap-3 border-t border-zinc-800/90 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => navigate('/dashboard')}>
          {t('common.back')}
        </Button>
        <button
          type="button"
          disabled={deleting}
          className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold text-red-400 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
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
