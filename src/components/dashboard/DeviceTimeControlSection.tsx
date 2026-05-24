import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Moon, PauseCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { formatWatchMinutes } from '../../lib/kidScreenControl'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Skeleton } from '../ui/Skeleton'
import { cn } from '../../lib/utils'

const SESSION_LIMIT_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'כבוי', value: null },
  { label: '15 דק׳', value: 15 },
  { label: '30 דק׳', value: 30 },
  { label: '45 דק׳', value: 45 },
  { label: '1 שעה', value: 60 },
  { label: '1.5 שעות', value: 90 },
  { label: '2 שעות', value: 120 },
]

type ParentalControlsPatch = {
  time_limit_minutes?: number | null
  sleep_time_start?: string | null
  is_remote_paused?: boolean
}

function DeviceTimeControlPanel({ device }: { device: Device }) {
  const updateParentalControls = useDeviceStore((s) => s.updateParentalControls)
  const [busyField, setBusyField] = useState<string | null>(null)

  const applyPatch = useCallback(
    async (field: string, patch: ParentalControlsPatch) => {
      setBusyField(field)
      const { error } = await updateParentalControls(device.id, patch)
      setBusyField(null)
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('ההגדרות נשמרו')
    },
    [device.id, updateParentalControls]
  )

  const limitValue = device.time_limit_minutes ?? null
  const bedtimeValue = device.sleep_time_start ?? ''

  return (
    <div className="rounded-xl border border-zinc-700/80 bg-zinc-950/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-zinc-100">{device.name}</p>
          <p className="text-xs text-zinc-500">
            {device.is_online ? 'מקוון עכשיו' : 'לא מקוון'}
            {device.is_remote_paused ? ' · מסך מוקפא' : ''}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
            device.is_online
              ? 'bg-brand-950/80 text-brand-200 ring-brand-800/80'
              : 'bg-zinc-800 text-zinc-400 ring-zinc-700'
          )}
        >
          {device.is_online ? 'פעיל' : 'כבוי'}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-300">
            <Clock className="h-4 w-4 text-zinc-500" aria-hidden />
            מגבלת זמן יומית
          </label>
          <select
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100"
            value={limitValue ?? ''}
            disabled={busyField === 'limit'}
            onChange={(e) => {
              const raw = e.target.value
              const next = raw === '' ? null : Number(raw)
              void applyPatch('limit', { time_limit_minutes: next })
            }}
          >
            {SESSION_LIMIT_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.value ?? ''}>
                {opt.label}
              </option>
            ))}
          </select>
          {limitValue != null && limitValue > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">מגבלה: {formatWatchMinutes(limitValue * 60)} ביום</p>
          ) : null}
        </div>

        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-300">
            <Moon className="h-4 w-4 text-zinc-500" aria-hidden />
            שעת שינה
          </label>
          <input
            type="time"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100"
            value={bedtimeValue}
            disabled={busyField === 'bedtime'}
            onChange={(e) => {
              const next = e.target.value.trim()
              void applyPatch('bedtime', { sleep_time_start: next || null })
            }}
          />
          <p className="mt-1 text-xs text-zinc-500">אחרי השעה הזו — מסך הילד ננעל עד למחר.</p>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-zinc-300">
            <PauseCircle className="h-4 w-4 text-red-400" aria-hidden />
            הקפאת מסך מרחוק
          </p>
          <Button
            type="button"
            variant={device.is_remote_paused ? 'secondary' : 'danger'}
            className={cn(
              'w-full py-3 text-base font-bold',
              !device.is_remote_paused && 'shadow-lg shadow-red-950/40'
            )}
            disabled={busyField === 'pause'}
            onClick={() => void applyPatch('pause', { is_remote_paused: !device.is_remote_paused })}
          >
            {busyField === 'pause' ? (
              <LoadingSpinner className="h-5 w-5 border-2 border-current border-t-transparent" />
            ) : null}
            {device.is_remote_paused ? 'בטל הקפאת מסך' : 'הקפא מסך מרחוק'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DeviceTimeControlSection() {
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading, error } = useDevices(ownerUserId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedId && devices[0]?.id) setSelectedId(devices[0].id)
  }, [devices, selectedId])

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId) ?? devices[0] ?? null,
    [devices, selectedId]
  )

  return (
    <section
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="time-control-section-title"
    >
      <header className="mb-4">
        <h2 id="time-control-section-title" className="text-lg font-bold text-zinc-50">
          בקרת זמן ומסכים
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
          הגדירו מגבלת צפייה, שעת שינה, או הקפיאו את מסך הילד מיידית — השינויים נכנסים לתוקף בזמן אמת.
        </p>
      </header>

      {loading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : devices.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center text-sm text-zinc-400">
          הוסיפו מכשיר ילד כדי לנהל בקרת זמן.
        </p>
      ) : (
        <div className="space-y-3">
          {devices.length > 1 ? (
            <select
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
          {selected ? <DeviceTimeControlPanel device={selected} /> : null}
        </div>
      )}
    </section>
  )
}
