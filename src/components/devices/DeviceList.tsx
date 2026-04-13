import { Trash2 } from 'lucide-react'
import type { Device } from '../../types'
import { Button } from '../ui/Button'
import { DeviceStatusBadge } from '../dashboard/DeviceStatusBadge'

export function DeviceList({
  devices,
  onDelete,
}: {
  devices: Device[]
  onDelete: (id: string) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {devices.map((d) => (
        <li
          key={d.id}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 dark:text-zinc-100">{d.name}</p>
            <p className="text-xs text-slate-500 dark:text-zinc-500" dir="ltr">
              {d.pairing_code ? `קוד: ${d.pairing_code}` : '—'}
            </p>
          </div>
          <DeviceStatusBadge isOnline={d.is_online} isBlocked={d.is_blocked} />
          <Button
            variant="ghost"
            className="!p-2 text-red-600"
            aria-label="מחק מכשיר"
            onClick={() => onDelete(d.id)}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
