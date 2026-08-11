import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ListMusic, Settings, ShieldCheck, Tablet, Tv } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { juicyPressableClass, useJuicyPointerBurst, useJuicyUiEnabled } from '../../contexts/JuicyUiContext'
import { LongPressNavButton } from './LongPressNavButton'

const SIDE_NAV_EXPANDED_KEY = 'safetube_parent_side_nav_expanded_v1'

type NavItem = {
  to: string
  labelKey: string
  icon: typeof Tv
  discreet?: boolean
  kidOnly?: boolean
}

/**
 * YouTube-style expandable side rail for tablet (md+) and desktop.
 * Mirrors BottomNav destinations; BottomNav stays for phones only.
 */
export function ParentSideNav() {
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const hasKidToken = useKidDeviceTokenPresent()
  const juicy = useJuicyUiEnabled()
  const juicyBurst = useJuicyPointerBurst()
  const isRtl = document.documentElement.dir === 'rtl' || i18n.language?.startsWith('he')
  const ExpandIcon = isRtl ? ChevronLeft : ChevronRight
  const CollapseIcon = isRtl ? ChevronRight : ChevronLeft

  const [expanded, setExpanded] = useState(() => {
    try {
      const raw = localStorage.getItem(SIDE_NAV_EXPANDED_KEY)
      if (raw === '0') return false
      if (raw === '1') return true
    } catch {
      /* ignore */
    }
    return true
  })

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_NAV_EXPANDED_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  const toggle = useCallback(() => setExpanded((v) => !v), [])

  const items: NavItem[] = [
    { to: '/dashboard', labelKey: 'nav.parentControl', icon: ShieldCheck, discreet: true },
    { to: '/channels', labelKey: 'nav.channels', icon: Tv },
    { to: '/playlists', labelKey: 'nav.playlists', icon: ListMusic, discreet: true },
    { to: '/kid', labelKey: 'nav.kid', icon: Tablet, kidOnly: true },
    { to: '/settings', labelKey: 'nav.settings', icon: Settings, discreet: true },
  ]

  const visible = items.filter((item) => !item.kidOnly || hasKidToken)

  return (
    <aside
      className={cn(
        'sticky top-0 z-40 hidden h-dvh shrink-0 flex-col border-e border-yt-border bg-yt-bg/95 backdrop-blur-md md:flex',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-[240px]' : 'w-[72px]'
      )}
      aria-label={t('nav.mainNavAria')}
    >
      <div className="flex h-14 items-center justify-end border-b border-yt-border px-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-yt-textMuted transition hover:bg-yt-surfaceHover hover:text-yt-text"
          aria-expanded={expanded}
          aria-label={expanded ? 'כווץ תפריט' : 'הרחב תפריט'}
        >
          {expanded ? <CollapseIcon className="h-5 w-5" /> : <ExpandIcon className="h-5 w-5" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {visible.map((item) => {
          const Icon = item.icon
          const label = t(item.labelKey)
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
          const discreet = Boolean(item.discreet && hasKidToken)

          if (discreet) {
            return (
              <LongPressNavButton
                key={item.to}
                to={item.to}
                label={label}
                icon={Icon}
                isActive={active}
                layout={expanded ? 'rail' : 'rail-collapsed'}
              />
            )
          }

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onPointerDown={juicy ? juicyBurst : undefined}
              onClick={(e) => {
                if (pathname === item.to) e.preventDefault()
              }}
              title={label}
              className={cn(
                juicyPressableClass(
                  juicy,
                  cn(
                    'flex rounded-xl text-sm font-medium transition',
                    expanded ? 'flex-row items-center gap-3 px-3 py-2.5' : 'flex-col items-center gap-1 px-1 py-2.5',
                    active ? 'bg-yt-surfaceHover text-yt-text' : 'text-yt-textMuted hover:bg-yt-surface/80 hover:text-yt-text'
                  )
                )
              )}
            >
              <Icon className="h-6 w-6 shrink-0" aria-hidden />
              {expanded ? <span className="truncate">{label}</span> : null}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
