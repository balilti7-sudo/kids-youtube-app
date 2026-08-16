import { ChevronDown, UsersRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../../lib/activeDeviceSelection'
import { cn } from '../../lib/utils'

/**
 * Custom profile menu (not a native <select>) so Android WebView cannot paint a
 * bright white system control over the dark parental dashboard.
 *
 * The menu is rendered in a portal: the header row uses overflow-hidden, which
 * silently clipped an inline absolute dropdown (menu opened but was invisible).
 */
export function ProfileSwitcher() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices } = useDevices(ownerUserId)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const activeId = useMemo(() => {
    const requested = searchParams.get('device')
    if (requested && devices.some((d) => d.id === requested)) return requested
    const saved = getSavedActiveChildProfileId()
    if (saved && devices.some((d) => d.id === saved)) return saved
    return devices[0]?.id ?? ''
  }, [devices, searchParams])

  const activeName = devices.find((d) => d.id === activeId)?.name ?? ''

  useEffect(() => {
    if (activeId) saveActiveChildProfileId(activeId)
  }, [activeId])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  if (devices.length === 0) return null

  // Single profile: still show who is active at the top — just without a menu.
  if (devices.length === 1) {
    return (
      <span className="inline-flex min-h-12 min-w-0 max-w-[min(100%,11rem)] items-center gap-1.5 rounded-2xl border border-zinc-700/80 bg-zinc-800 px-2.5 py-2 text-xs font-black text-zinc-50 shadow-md shadow-black/25 ring-1 ring-white/10 sm:max-w-[14rem] sm:gap-2 sm:px-3">
        <UsersRound className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
        <span className="min-w-[3rem] max-w-full truncate font-semibold text-zinc-100">
          {activeName}
        </span>
      </span>
    )
  }

  const toggleOpen = () => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
    setOpen(true)
  }

  const handleChange = (nextDeviceId: string) => {
    if (!nextDeviceId) return
    saveActiveChildProfileId(nextDeviceId)
    const next = new URLSearchParams(location.search)
    next.set('device', nextDeviceId)
    next.delete('channel')
    navigate({ pathname: location.pathname, search: `?${next.toString()}` }, { replace: false })
    setOpen(false)
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="החלף פרופיל"
        onClick={toggleOpen}
        className={cn(
          'inline-flex min-h-12 min-w-0 max-w-[min(100%,11rem)] items-center gap-1.5 rounded-2xl border border-zinc-700/80 bg-zinc-800 px-2.5 py-2 text-xs font-black text-zinc-50 shadow-md shadow-black/25 ring-1 ring-white/10 transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 sm:max-w-[14rem] sm:gap-2 sm:px-3'
        )}
      >
        <UsersRound className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
        <span className="hidden shrink-0 whitespace-nowrap sm:inline">החלף פרופיל</span>
        {/* min-w keeps the active profile name visible even when the header squeezes. */}
        <span className="min-w-[3rem] max-w-full truncate font-semibold text-zinc-100">
          {activeName}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-zinc-400 transition', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && menuPos
        ? createPortal(
            <ul
              ref={menuRef}
              role="listbox"
              aria-label="בחירת פרופיל"
              style={{ top: menuPos.top, right: menuPos.right }}
              className="fixed z-[100020] min-w-[11rem] max-w-[16rem] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40 ring-1 ring-white/10"
            >
              {devices.map((device) => {
                const selected = device.id === activeId
                return (
                  <li key={device.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      className={cn(
                        'flex min-h-12 w-full items-center px-3 py-2.5 text-start text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400',
                        selected ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-100 hover:bg-zinc-800'
                      )}
                      onClick={() => handleChange(device.id)}
                    >
                      <span className="truncate">{device.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body
          )
        : null}
    </div>
  )
}
