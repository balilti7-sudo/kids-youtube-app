import { useState } from 'react'
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { ChildRuntimeProvider } from '../../contexts/ChildRuntimeContext'
import { StatsGrid } from './StatsGrid'
import { DashboardDevicesSection } from './DashboardDevicesSection'
import { ParentSetupGuide } from './ParentSetupGuide'
import { LocalScreenTimeParentCard } from './LocalScreenTimeParentCard'
import { LoadingSpinner } from '../ui/LoadingSpinner'

const SETUP_GUIDE_DISMISS_KEY = 'safetube_parent_setup_guide_dismissed_v1'

function ParentDashboardInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading } = useDevices(ownerUserId)
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try {
      return localStorage.getItem(SETUP_GUIDE_DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  const hasProfiles = devices.length > 0
  const hasChannelsManaged = devices.some((d) => (d.channel_count ?? 0) > 0)
  const skipEmptyRedirect = searchParams.get('skipAdd') === '1'
  const manageFromQuery = searchParams.get('manage')

  // Legacy ?manage= → dedicated manage page
  if (manageFromQuery) {
    return <Navigate to={`/dashboard/manage/${encodeURIComponent(manageFromQuery)}`} replace />
  }

  if (!loading && devices.length === 0 && !skipEmptyRedirect) {
    return <Navigate to="/dashboard/add-profile" replace />
  }

  if (loading && devices.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner className="h-8 w-8 border-2 border-sky-400 border-t-transparent" />
      </div>
    )
  }

  const dismissGuide = () => {
    setGuideDismissed(true)
    try {
      localStorage.setItem(SETUP_GUIDE_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 pb-3">
      <header>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">{t('dashboard.title')}</h1>
        <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">{t('dashboard.subtitle')}</p>
      </header>

      <ParentSetupGuide
        hasProfiles={hasProfiles}
        hasChannelsManaged={hasChannelsManaged}
        dismissed={guideDismissed}
        onDismiss={dismissGuide}
        onAddProfile={() => navigate('/dashboard/add-profile')}
        onManageChannels={() => {
          const first = devices[0]
          if (first) navigate(`/dashboard/manage/${first.id}`)
          else {
            navigate('/dashboard/add-profile')
            toast.info(t('dashboard.createProfileFirst'))
          }
        }}
      />

      <DashboardDevicesSection onManageChannels={(id) => navigate(`/dashboard/manage/${id}`)} />

      <StatsGrid devices={devices} />
      <LocalScreenTimeParentCard />
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
