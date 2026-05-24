import { useDeviceStore } from '../../stores/deviceStore'
import { StatsGrid } from './StatsGrid'
import { DashboardDevicesSection } from './DashboardDevicesSection'
import { ParentSingleVideoSearchSection } from './ParentSingleVideoSearchSection'

export function ParentDashboard() {
  const devices = useDeviceStore((s) => s.devices)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 pb-3">
      <header>
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">לוח בקרה</h1>
        <p className="text-xs text-slate-600 dark:text-zinc-400 sm:text-sm">סקירה מהירה ומכשירים</p>
      </header>

      <StatsGrid devices={devices} />
      <ParentSingleVideoSearchSection />
      <DashboardDevicesSection />
    </div>
  )
}
