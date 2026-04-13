import { NavLink } from 'react-router-dom'
import { Home, Tv, Settings } from 'lucide-react'
import { cn } from '../../lib/utils'

const links = [
  { to: '/dashboard', label: 'בית', icon: Home },
  { to: '/channels', label: 'ערוצים', icon: Tv },
  { to: '/settings', label: 'הגדרות', icon: Settings },
]

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      aria-label="ניווט ראשי"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition',
                isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-500 dark:text-zinc-500'
              )
            }
          >
            <Icon className="h-6 w-6" aria-hidden />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
