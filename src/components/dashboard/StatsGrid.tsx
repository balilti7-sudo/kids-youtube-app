import type { Device } from '../../types'

export function StatsGrid({ devices }: { devices: Device[] }) {
  const total = devices.length
  const blocked = devices.filter((d) => d.is_blocked).length
  const channels = devices.reduce((acc, d) => acc + (d.channel_count ?? 0), 0)

  const items = [
    { label: 'מכשירים', value: total },
    { label: 'חסומים', value: blocked },
    { label: 'ערוצים (סה״כ)', value: channels },
  ]

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-slate-100 dark:bg-zinc-900 dark:ring-zinc-800"
        >
          <p className="text-2xl font-extrabold text-brand-700 dark:text-brand-500">{item.value}</p>
          <p className="text-xs font-medium text-slate-600 dark:text-zinc-400">{item.label}</p>
        </div>
      ))}
    </div>
  )
}
