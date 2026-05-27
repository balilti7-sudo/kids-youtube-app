import { useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { StatsGrid } from './StatsGrid'
import { DashboardDevicesSection } from './DashboardDevicesSection'
import { ChannelManager } from '../channels/ChannelManager'
import { LocalScreenTimeParentCard } from './LocalScreenTimeParentCard'

export function ParentDashboard() {
  const devices = useDeviceStore((s) => s.devices)
  const [managedDeviceId, setManagedDeviceId] = useState<string | null>(null)
  const managedDevice = devices.find((d) => d.id === managedDeviceId) ?? null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3">
      <header>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">בקרת הורים</h1>
        <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">
          ניהול פרופילים, הרשאות וערוצים מאושרים.
        </p>
      </header>

      <StatsGrid devices={devices} />
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
        </section>
      ) : null}
    </div>
  )
}
