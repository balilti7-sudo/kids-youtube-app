import { useSyncExternalStore } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Home, Settings, Tablet, Tv } from 'lucide-react'
import { BottomNav } from './BottomNav'
import { PageBackBar } from './PageBackBar'
import { ParentAppFooter } from './ParentAppFooter'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { cn } from '../../lib/utils'

function subscribeKidTokenChanged(onStoreChange: () => void) {
  const fn = () => onStoreChange()
  window.addEventListener('storage', fn)
  window.addEventListener('safetube-kid-token-changed', fn as EventListener)
  return () => {
    window.removeEventListener('storage', fn)
    window.removeEventListener('safetube-kid-token-changed', fn as EventListener)
  }
}

function getKidTokenPresent() {
  return typeof window !== 'undefined' && Boolean(getSavedChildAccessToken())
}

function DesktopSidebar() {
  const { pathname } = useLocation()
  const hasKidToken = useSyncExternalStore(subscribeKidTokenChanged, getKidTokenPresent, () => false)
  const links = [
    { to: '/dashboard', label: 'בית', icon: Home },
    { to: '/channels', label: 'ערוצים', icon: Tv },
    ...(hasKidToken ? [{ to: '/kid', label: 'ילד', icon: Tablet }] as const : []),
    { to: '/settings', label: 'הגדרות', icon: Settings },
  ]

  return (
    <aside className="hidden lg:block">
      <div className="app-floating-surface sticky top-6 w-72 p-4">
        <p className="mb-3 text-sm font-extrabold text-brand-700 dark:text-brand-500">SafeTube</p>
        <p className="mb-4 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-950/40 dark:text-brand-100">
          ניהול הורים פשוט, בטוח וידידותי לילדים.
        </p>
        <nav className="space-y-2" aria-label="ניווט שולחני">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={(e) => {
                if (pathname === to) e.preventDefault()
              }}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition',
                  isActive
                    ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </aside>
  )
}

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="safe-pb-nav mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pt-4 sm:px-4 sm:pt-6 lg:px-6">
        <DesktopSidebar />
        <div className="min-w-0 flex-1">
          <div className="app-floating-surface w-full p-5 sm:p-6 lg:p-7">
            <PageBackBar />
            <Outlet />
            <ParentAppFooter />
          </div>
        </div>
      </main>
      <BottomNav />
    </div>
  )
}
