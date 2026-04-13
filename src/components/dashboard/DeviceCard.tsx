import { Smartphone, Tablet } from 'lucide-react'
import type { Device } from '../../types'
import { DeviceStatusBadge } from './DeviceStatusBadge'
import { cn } from '../../lib/utils'

export function DeviceCard({ device, onOpen }: { device: Device; onOpen: (d: Device) => void }) {
  const Icon = device.device_type === 'tablet' ? Tablet : Smartphone
  return (
    <button
      type="button"
      onClick={() => onOpen(device)}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-start shadow-sm transition hover:border-brand-200 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-700/50'
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{device.name}</p>
        <p className="text-xs text-slate-500 dark:text-zinc-500">
          {device.channel_count ?? 0} ערוצים מאושרים
        </p>
      </div>
      <DeviceStatusBadge isOnline={device.is_online} isBlocked={device.is_blocked} />
    </button>
  )
}
