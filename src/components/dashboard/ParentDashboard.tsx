import { useDeviceStore } from '../../stores/deviceStore'
import { StatsGrid } from './StatsGrid'
import { DashboardDevicesSection } from './DashboardDevicesSection'

export function ParentDashboard() {
  const devices = useDeviceStore((s) => s.devices)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">לוח בקרה</h1>
        <p className="text-sm text-slate-600 dark:text-zinc-400">סקירה מהירה ומכשירים</p>
      </header>

      <StatsGrid devices={devices} />
      <DashboardDevicesSection />
    </div>
  )
}
