import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Settings2, Smartphone } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useSubscription } from '../../hooks/useSubscription'
import { useDeviceStore } from '../../stores/deviceStore'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { ErrorState } from '../ui/ErrorState'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { AllowShortsDeviceSettings } from './AllowShortsDeviceSettings'
import { DailyTimeLimitDeviceSettings } from './DailyTimeLimitDeviceSettings'
import { DeviceOsControlsSettings } from './DeviceOsControlsSettings'
import { toast } from 'sonner'
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
  openAddProfileSignal = 0,
}: {
  activeManagementDeviceId?: string | null
  onManageChannels: (deviceId: string) => void
  /** Increment to open the add-profile modal (from setup guide). */
  openAddProfileSignal?: number
}) {
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)
  const { t } = useTranslation()

  const [modalOpen, setModalOpen] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [saving, setSaving] = useState(false)
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

  useEffect(() => {
    if (openAddProfileSignal > 0) {
      setDeviceName(t('dashboard.defaultProfileName'))
      setModalOpen(true)
    }
  }, [openAddProfileSignal, t])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openModal = () => {
    setDeviceName(t('dashboard.defaultProfileName'))
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
  }

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
        setExpandedIds((prev) => new Set(prev).add(data.id))
        await refetch()
        setModalOpen(false)
        setDeviceName('')
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error(t('common.error'), { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      id="dashboard-profiles"
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="profiles-section-title"
    >
      <div className="mb-2 flex flex-col gap-1.5">
        <div>
          <h2 id="profiles-section-title" className="text-lg font-bold text-zinc-50">
            {t('dashboard.profiles')}
          </h2>
          <p className="text-xs text-zinc-500">{t('dashboard.profilesLinked', { count: `${devices.length} / ${max}` })}</p>
        </div>

        <div
          className={cn(
            'rounded-xl border px-3 py-3',
            devices.length === 0
              ? 'border-sky-400/40 bg-sky-950/30 ring-1 ring-sky-400/25'
              : 'border-zinc-700/50 bg-zinc-950/40'
          )}
        >
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {devices.length === 0 ? t('dashboard.step1Start') : t('dashboard.childProfiles')}
          </p>
          <p className="mb-3 text-[13px] leading-snug text-zinc-400">
            {devices.length === 0 ? t('dashboard.createProfileLeadEmpty') : t('dashboard.createProfileLead')}
          </p>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[15px] font-bold text-zinc-900 shadow-md shadow-black/25 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={openModal}
            disabled={atLimit || !ownerUserId}
          >
            <Plus className="h-5 w-5 shrink-0" aria-hidden />
            {t('dashboard.addProfile')}
          </button>
        </div>
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
          <Button type="button" onClick={openModal} disabled={!ownerUserId || atLimit}>
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

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={t('dashboard.newProfileTitle')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleAdd()} disabled={saving}>
              {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-400">{t('dashboard.newProfileHint')}</p>
        <label className="mb-1 block text-sm font-medium text-zinc-300">{t('dashboard.profileName')}</label>
        <Input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder={t('dashboard.profileNamePlaceholder')}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
        />
      </Modal>
    </section>
  )
}
