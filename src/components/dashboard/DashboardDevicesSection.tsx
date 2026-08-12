import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Plus, Settings2, Smartphone } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useSubscription } from '../../hooks/useSubscription'
import { Button } from '../ui/Button'
import { Skeleton } from '../ui/Skeleton'
import { ErrorState } from '../ui/ErrorState'
import { AllowShortsDeviceSettings } from './AllowShortsDeviceSettings'
import { DailyTimeLimitDeviceSettings } from './DailyTimeLimitDeviceSettings'
import { DeviceOsControlsSettings } from './DeviceOsControlsSettings'
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
  expanded,
  onToggleExpanded,
  activeManagementDeviceId,
  onManageChannels,
}: {
  device: Device
  expanded: boolean
  onToggleExpanded: () => void
  activeManagementDeviceId?: string | null
  onManageChannels: (deviceId: string) => void
}) {
  const { t } = useTranslation()
  const limitLabel = formatLimitBrief(device.daily_time_limit_minutes, t)
  const shortsLabel = device.allow_shorts ? t('shorts.allowOn') : t('shorts.allowOff')
  const youtubeLabel = device.block_youtube_app
    ? t('parentalOs.summaryYoutubeOn')
    : t('parentalOs.summaryYoutubeOff')
  const browserLabel = device.browser_filter_enabled
    ? t('parentalOs.summaryBrowserOn')
    : t('parentalOs.summaryBrowserOff')

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-2.5 ring-1 ring-zinc-800/60">
      <div className="flex flex-row items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={`profile-settings-${device.id}`}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800/90 text-zinc-400 ring-1 ring-zinc-700/80"
            aria-hidden
          >
            <Smartphone className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-100 sm:text-base">
              {device.name}
            </span>
            {!expanded ? (
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                {limitLabel} · {shortsLabel} · {youtubeLabel} · {browserLabel}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
        <Button
          type="button"
          variant="primary"
          className={cn(
            'h-9 shrink-0 justify-center gap-1.5 rounded-lg !px-4 !py-2 text-xs font-semibold sm:text-sm',
            activeManagementDeviceId === device.id &&
              'ring-2 ring-brand-300/80 ring-offset-1 ring-offset-zinc-950'
          )}
          onClick={() => onManageChannels(device.id)}
          aria-label={t('dashboard.manageChannelsFor', { name: device.name })}
          aria-current={activeManagementDeviceId === device.id ? 'true' : undefined}
        >
          <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{t('dashboard.manageChannels')}</span>
        </Button>
      </div>

      {expanded ? (
        <div id={`profile-settings-${device.id}`} className="flex flex-col gap-2">
          <AllowShortsDeviceSettings device={device} />
          <DeviceOsControlsSettings device={device} />
          <DailyTimeLimitDeviceSettings device={device} />
        </div>
      ) : null}
    </li>
  )
}

export function DashboardDevicesSection({
  activeManagementDeviceId,
  onManageChannels,
}: {
  activeManagementDeviceId?: string | null
  onManageChannels: (deviceId: string) => void
}) {
  const navigate = useNavigate()
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const { t } = useTranslation()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [collapseSeeded, setCollapseSeeded] = useState(false)

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  useEffect(() => {
    if (loading || collapseSeeded || devices.length === 0) return
    if (devices.length === 1) {
      setExpandedIds(new Set([devices[0].id]))
    } else {
      setExpandedIds(new Set())
    }
    setCollapseSeeded(true)
  }, [loading, devices, collapseSeeded])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const goAddProfile = () => {
    navigate('/dashboard/add-profile')
  }

  return (
    <section
      id="dashboard-profiles"
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="profiles-section-title"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="profiles-section-title" className="text-lg font-bold text-zinc-50">
            {t('dashboard.profiles')}
          </h2>
          <p className="text-xs text-zinc-500">{t('dashboard.profilesLinked', { count: `${devices.length} / ${max}` })}</p>
        </div>
        {!atLimit ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9 shrink-0 gap-1.5 !px-3 !py-2 text-xs font-semibold sm:text-sm"
            onClick={goAddProfile}
            disabled={!ownerUserId}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            {t('dashboard.addProfile')}
          </Button>
        ) : null}
      </div>

      {isDevFallback ? (
        <p className="mb-3 rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
          <span className="font-semibold text-amber-50">{t('dashboard.devModeLabel')}</span> {t('dashboard.devModeBody')}
        </p>
      ) : null}
      {atLimit ? (
        <p className="mb-3 text-xs text-amber-400/90">{t('dashboard.planLimitReached')}</p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 py-5 text-center">
          <Smartphone className="h-10 w-10 text-zinc-600" aria-hidden />
          <p className="text-sm font-medium text-zinc-300">{t('dashboard.noProfilesYet')}</p>
          <p className="max-w-xs text-xs text-zinc-500">{t('dashboard.noProfilesHint')}</p>
          <Button type="button" onClick={goAddProfile} disabled={!ownerUserId || atLimit}>
            {t('dashboard.addProfileNow')}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <ProfileDeviceCard
              key={d.id}
              device={d}
              expanded={expandedIds.has(d.id)}
              onToggleExpanded={() => toggleExpanded(d.id)}
              activeManagementDeviceId={activeManagementDeviceId}
              onManageChannels={onManageChannels}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
