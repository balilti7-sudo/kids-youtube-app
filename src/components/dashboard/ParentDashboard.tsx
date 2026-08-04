import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import { clearActiveChildProfileIdIfMatches } from '../../lib/activeDeviceSelection'
import { ChildRuntimeProvider } from '../../contexts/ChildRuntimeContext'
import { StatsGrid } from './StatsGrid'
import { DashboardDevicesSection } from './DashboardDevicesSection'
import { ParentSetupGuide } from './ParentSetupGuide'
import { ChannelManager } from '../channels/ChannelManager'
import { LocalScreenTimeParentCard } from './LocalScreenTimeParentCard'

const SETUP_GUIDE_DISMISS_KEY = 'safetube_parent_setup_guide_dismissed_v1'

function ParentDashboardInner() {
  const { t } = useTranslation()
  const devices = useDeviceStore((s) => s.devices)
  const removeDevice = useDeviceStore((s) => s.removeDevice)
  const [managedDeviceId, setManagedDeviceId] = useState<string | null>(null)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const [openAddProfileSignal, setOpenAddProfileSignal] = useState(0)
  const [showPairingSignal, setShowPairingSignal] = useState(0)
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try {
      return localStorage.getItem(SETUP_GUIDE_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const managedDevice = devices.find((d) => d.id === managedDeviceId) ?? null

  const hasProfiles = devices.length > 0
  const hasPairingCodeReady = devices.some((d) => Boolean(d.pairing_code?.trim()))
  const hasChannelsManaged =
    Boolean(managedDeviceId) || devices.some((d) => (d.channel_count ?? 0) > 0)

  useEffect(() => {
    if (!managedDeviceId) return
    const el = document.getElementById('dashboard-channel-manager')
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [managedDeviceId])

  const dismissGuide = () => {
    setGuideDismissed(true)
    try {
      localStorage.setItem(SETUP_GUIDE_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const handleDeleteManagedProfile = async () => {
    if (!managedDeviceId || deletingProfile) return
    const confirmed = window.confirm(t('dashboard.deleteProfileConfirm'))
    if (!confirmed) return

    setDeletingProfile(true)
    const { error } = await removeDevice(managedDeviceId)
    setDeletingProfile(false)

    if (error) {
      toast.error(t('dashboard.deleteFailed'), { description: error.message })
      return
    }

    clearActiveChildProfileIdIfMatches(managedDeviceId)
    toast.success(t('dashboard.profileRemoved'))
    setManagedDeviceId(null)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 pb-3">
      <header>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">{t('dashboard.title')}</h1>
        <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">{t('dashboard.subtitle')}</p>
      </header>

      <ParentSetupGuide
        hasProfiles={hasProfiles}
        hasPairingCodeReady={hasPairingCodeReady}
        hasChannelsManaged={hasChannelsManaged}
        dismissed={guideDismissed}
        onDismiss={dismissGuide}
        onAddProfile={() => {
          setOpenAddProfileSignal((n) => n + 1)
          document.getElementById('dashboard-profiles')?.scrollIntoView({ behavior: 'smooth' })
        }}
        onShowPairing={() => setShowPairingSignal((n) => n + 1)}
        onManageChannels={() => {
          const first = devices[0]
          if (first) setManagedDeviceId(first.id)
          else {
            setOpenAddProfileSignal((n) => n + 1)
            toast.info(t('dashboard.createProfileFirst'))
          }
        }}
      />

      <StatsGrid devices={devices} />
      <LocalScreenTimeParentCard />
      <DashboardDevicesSection
        activeManagementDeviceId={managedDeviceId}
        onManageChannels={setManagedDeviceId}
        openAddProfileSignal={openAddProfileSignal}
        showPairingSignal={showPairingSignal}
      />
      {managedDeviceId ? (
        <section
          id="dashboard-channel-manager"
          className="rounded-2xl border border-zinc-700/60 bg-zinc-900/70 p-3 shadow-inner ring-1 ring-zinc-800/80 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-50">{t('dashboard.channelManagerTitle')}</h2>
              <p className="text-xs text-zinc-500">
                {managedDevice
                  ? t('dashboard.activeProfile', { name: managedDevice.name })
                  : t('dashboard.chooseProfile')}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-50"
              onClick={() => setManagedDeviceId(null)}
            >
              {t('common.close')}
            </button>
          </div>
          <ChannelManager managedDeviceId={managedDeviceId} embedded />
          <footer className="mt-4 flex justify-end border-t border-zinc-800/90 pt-3">
            <button
              type="button"
              disabled={deletingProfile}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
              onClick={() => void handleDeleteManagedProfile()}
            >
              {deletingProfile ? t('common.loading') : t('dashboard.deleteProfile')}
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  )
}

export function ParentDashboard() {
  return (
    <ChildRuntimeProvider>
      <ParentDashboardInner />
    </ChildRuntimeProvider>
  )
}
