import { useNavigate } from 'react-router-dom'
import { Plus, Settings2, Smartphone } from 'lucide-react'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useSubscription } from '../../hooks/useSubscription'
import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Skeleton'
import { ErrorState } from '../ui/ErrorState'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'

function formatLimitBrief(minutes: number | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const n = Number(minutes ?? 60)
  if (!Number.isFinite(n) || n < 0) return t('timeLimit.minutesAbbr', { count: 60 })
  if (n === 0) return t('timeLimit.unlimited')
  if (n < 60) return t('timeLimit.minutesAbbr', { count: Math.round(n) })
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  if (m === 0) return t('timeLimit.hoursAbbr', { count: h })
  return t('timeLimit.hoursMinutesAbbr', { hours: h, minutes: m })
}

function ProfileDeviceCard({
  device,
  onManageChannels,
}: {
  device: Device
  onManageChannels: (deviceId: string) => void
}) {
  const { t } = useTranslation()
  const limitLabel = formatLimitBrief(device.daily_time_limit_minutes, t)
  const shortsLabel = device.allow_shorts ? t('shorts.allowOn') : t('shorts.allowOff')
  const thumbsLabel = device.hide_thumbnails ? t('thumbnails.summaryHidden') : t('thumbnails.summaryShown')
  const youtubeLabel = device.block_youtube_app
    ? t('parentalOs.summaryYoutubeOn')
    : t('parentalOs.summaryYoutubeOff')
  const browserLabel = device.browser_filter_enabled
    ? t('parentalOs.summaryBrowserOn')
    : t('parentalOs.summaryBrowserOff')

  return (
    <li className="rounded-2xl border border-zinc-700/80 bg-zinc-950/70 p-3.5 ring-1 ring-zinc-800/60 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-800/90 text-zinc-300 ring-1 ring-zinc-700/80"
            aria-hidden
          >
            <Smartphone className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-zinc-50">{device.name}</span>
            <span className="mt-1 block text-xs leading-relaxed text-zinc-500 sm:truncate">
              {limitLabel} · {shortsLabel} · {thumbsLabel} · {youtubeLabel} · {browserLabel}
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full shrink-0 justify-center gap-2 rounded-2xl border-zinc-600 bg-zinc-800 text-zinc-50 hover:bg-zinc-700 sm:w-auto"
          onClick={() => onManageChannels(device.id)}
          aria-label={t('dashboard.manageChannelsFor', { name: device.name })}
        >
          <Settings2 className="h-5 w-5 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{t('dashboard.manageChannels')}</span>
        </Button>
      </div>
    </li>
  )
}

export function DashboardDevicesSection({
  onManageChannels,
}: {
  onManageChannels: (deviceId: string) => void
}) {
  const navigate = useNavigate()
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const { t } = useTranslation()

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  const goAddProfile = () => {
    navigate('/dashboard/add-profile')
  }

  return (
    <section
      id="dashboard-profiles"
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/85 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="profiles-section-title"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="profiles-section-title" className="text-xl font-bold text-zinc-50">
            {t('dashboard.profiles')}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t('dashboard.profilesLinked', { count: `${devices.length} / ${max}` })}
          </p>
        </div>
        {!atLimit ? (
          <Button
            type="button"
            variant="secondary"
            className="w-full shrink-0 gap-2 rounded-2xl sm:w-auto"
            onClick={goAddProfile}
            disabled={!ownerUserId}
          >
            <Plus className="h-5 w-5 shrink-0" aria-hidden />
            {t('dashboard.addProfile')}
          </Button>
        ) : null}
      </div>

      {isDevFallback ? (
        <p className="mb-4 rounded-2xl border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-xs leading-relaxed text-amber-100/90">
          <span className="font-semibold text-amber-50">{t('dashboard.devModeLabel')}</span> {t('dashboard.devModeBody')}
        </p>
      ) : null}
      {atLimit ? (
        <p className="mb-4 text-sm text-amber-400/90">{t('dashboard.planLimitReached')}</p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/40 px-4 py-8 text-center">
          <Smartphone className="h-12 w-12 text-zinc-600" aria-hidden />
          <p className="text-base font-medium text-zinc-300">{t('dashboard.noProfilesYet')}</p>
          <p className="max-w-xs text-sm text-zinc-500">{t('dashboard.noProfilesHint')}</p>
          <Button type="button" className="min-h-14 w-full max-w-xs rounded-2xl" onClick={goAddProfile} disabled={!ownerUserId || atLimit}>
            {t('dashboard.addProfileNow')}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {devices.map((d) => (
            <ProfileDeviceCard key={d.id} device={d} onManageChannels={onManageChannels} />
          ))}
        </ul>
      )}
    </section>
  )
}
