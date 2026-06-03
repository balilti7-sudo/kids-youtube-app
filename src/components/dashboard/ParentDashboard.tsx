import { useState } from 'react'
import { toast } from 'sonner'
import { useDeviceStore } from '../../stores/deviceStore'
import { clearActiveChildProfileIdIfMatches } from '../../lib/activeDeviceSelection'
import { ChildRuntimeProvider } from '../../contexts/ChildRuntimeContext'
import { StatsGrid } from './StatsGrid'
import { ParentGlobalVideoSearchSection } from './ParentGlobalVideoSearchSection'
import { DashboardDevicesSection } from './DashboardDevicesSection'
import { ChannelManager } from '../channels/ChannelManager'
import { LocalScreenTimeParentCard } from './LocalScreenTimeParentCard'

function ParentDashboardInner() {
  const devices = useDeviceStore((s) => s.devices)
  const removeDevice = useDeviceStore((s) => s.removeDevice)
  const [managedDeviceId, setManagedDeviceId] = useState<string | null>(null)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const managedDevice = devices.find((d) => d.id === managedDeviceId) ?? null

  const handleDeleteManagedProfile = async () => {
    if (!managedDeviceId || deletingProfile) return
    const confirmed = window.confirm('האם אתה בטוח שברצונך למחוק פרופיל זה לצמיתות?')
    if (!confirmed) return

    setDeletingProfile(true)
    const { error } = await removeDevice(managedDeviceId)
    setDeletingProfile(false)

    if (error) {
      toast.error('מחיקה נכשלה', { description: error.message })
      return
    }

    clearActiveChildProfileIdIfMatches(managedDeviceId)
    toast.success('הפרופיל הוסר')
    setManagedDeviceId(null)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3">
      <header>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">בקרת הורים</h1>
        <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">
          ניהול פרופילים, הרשאות וערוצים מאושרים.
        </p>
      </header>

      <StatsGrid devices={devices} />
      <ParentGlobalVideoSearchSection devices={devices} />
      <LocalScreenTimeParentCard />
      <DashboardDevicesSection activeManagementDeviceId={managedDeviceId} onManageChannels={setManagedDeviceId} />
      {managedDeviceId ? (
        <section className="rounded-2xl border border-zinc-700/60 bg-zinc-900/70 p-3 shadow-inner ring-1 ring-zinc-800/80 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-zinc-50">ניהול ערוצים</h2>
              <p className="text-xs text-zinc-500">
                {managedDevice ? `פרופיל פעיל: ${managedDevice.name}` : 'בחרו פרופיל מהרשימה למעלה.'}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-50"
              onClick={() => setManagedDeviceId(null)}
            >
              סגור
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
              {deletingProfile ? 'מוחק…' : 'מחק פרופיל מכשיר זה'}
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
