import { NavLink, useLocation } from 'react-router-dom'
import { Home, Tv, Settings, Tablet } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { LongPressNavButton } from './LongPressNavButton'

export function BottomNav() {
  const { pathname } = useLocation()
  const hasKidToken = useKidDeviceTokenPresent()

  const parentNavDiscreet = hasKidToken

  return (
    <nav
      className="bottom-nav fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      aria-label="ניווט ראשי"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {parentNavDiscreet ? (
          <LongPressNavButton to="/dashboard" label="בית" icon={Home} isActive={pathname === '/dashboard'} />
        ) : (
          <NavLink
            to="/dashboard"
            onClick={(e) => {
              if (pathname === '/dashboard') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-zinc-500'
              )
            }
          >
            <Home className="h-6 w-6" aria-hidden />
            בית
          </NavLink>
        )}

        {parentNavDiscreet ? (
          <LongPressNavButton to="/channels" label="ערוצים" icon={Tv} isActive={pathname === '/channels'} />
        ) : (
          <NavLink
            to="/channels"
            onClick={(e) => {
              if (pathname === '/channels') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-zinc-500'
              )
            }
          >
            <Tv className="h-6 w-6" aria-hidden />
            ערוצים
          </NavLink>
        )}

        {hasKidToken ? (
          <NavLink
            to="/kid"
            onClick={(e) => {
              if (pathname === '/kid') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-zinc-500'
              )
            }
          >
            <Tablet className="h-6 w-6" aria-hidden />
            ילד
          </NavLink>
        ) : null}

        {parentNavDiscreet ? (
          <LongPressNavButton to="/settings" label="הגדרות" icon={Settings} isActive={pathname === '/settings'} />
        ) : (
          <NavLink
            to="/settings"
            onClick={(e) => {
              if (pathname === '/settings') {
                e.preventDefault()
              }
            }}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition',
                isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-zinc-500'
              )
            }
          >
            <Settings className="h-6 w-6" aria-hidden />
            הגדרות
          </NavLink>
        )}
      </div>
    </nav>
  )
}
