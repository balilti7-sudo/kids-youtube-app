import { UsersRound } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../../lib/activeDeviceSelection'

export function ProfileSwitcher() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices } = useDevices(ownerUserId)

  const activeId = useMemo(() => {
    const requested = searchParams.get('device')
    if (requested && devices.some((d) => d.id === requested)) return requested
    const saved = getSavedActiveChildProfileId()
    if (saved && devices.some((d) => d.id === saved)) return saved
    return devices[0]?.id ?? ''
  }, [devices, searchParams])

  useEffect(() => {
    if (activeId) saveActiveChildProfileId(activeId)
  }, [activeId])

  if (devices.length <= 1) return null

  const handleChange = (nextDeviceId: string) => {
    if (!nextDeviceId) return
    saveActiveChildProfileId(nextDeviceId)
    const next = new URLSearchParams(location.search)
    next.set('device', nextDeviceId)
    next.delete('channel')
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: false })
  }

  return (
    <label className="inline-flex min-w-0 max-w-[9rem] items-center gap-1.5 rounded-2xl border border-zinc-700/80 bg-zinc-800 px-2 py-2 text-xs font-black text-zinc-50 shadow-md shadow-black/25 ring-1 ring-white/10 transition hover:bg-zinc-700 sm:max-w-[14rem] sm:gap-2 sm:px-3">
      <UsersRound className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
      <span className="hidden shrink-0 whitespace-nowrap min-[420px]:inline">החלף פרופיל</span>
      <select
        value={activeId}
        onChange={(e) => handleChange(e.target.value)}
        className="min-w-0 max-w-[5.25rem] truncate bg-transparent text-xs font-semibold text-zinc-100 outline-none sm:max-w-[10rem]"
        aria-label="החלף פרופיל"
      >
        {devices.map((device) => (
          <option key={device.id} value={device.id} className="bg-zinc-950 text-zinc-100">
            {device.name}
          </option>
        ))}
      </select>
    </label>
  )
}
