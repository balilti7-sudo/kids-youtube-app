import { Link, useNavigate } from 'react-router-dom'
import { CreditCard, Link2, Info, LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSubscription } from '../../hooks/useSubscription'
import { Button } from '../ui/Button'

const items = [
  { to: '/subscription', label: 'ניהול מנוי', icon: CreditCard },
  { to: '/devices', label: 'חיבור מכשיר', icon: Link2 },
  { to: '#', label: 'אודות', icon: Info },
]

export function SettingsPanel() {
  const navigate = useNavigate()
  const { user, profile, signOut } = useAuth()
  const { subscription } = useSubscription(user?.id)

  const handleLogout = async () => {
    await signOut()
    navigate('/auth', { replace: true })
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">הגדרות</h1>
      </header>

      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <img
          src={profile?.avatar_url || undefined}
          alt=""
          className="h-14 w-14 rounded-full bg-slate-100 object-cover dark:bg-zinc-800"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{profile?.full_name || 'משתמש'}</p>
          <p className="truncate text-xs text-slate-500 dark:text-zinc-500" dir="ltr">
            {profile?.email}
          </p>
          {subscription ? (
            <p className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-500">
              מנוי: {subscription.plan} · {subscription.status}
            </p>
          ) : null}
        </div>
      </div>

      <nav className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-slate-800 last:border-0 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Icon className="h-5 w-5 text-slate-500 dark:text-zinc-500" />
            <span className="font-medium">{label}</span>
          </Link>
        ))}
      </nav>

      <Button variant="danger" className="w-full gap-2" onClick={() => void handleLogout()}>
        <LogOut className="h-5 w-5" />
        התנתקות
      </Button>
    </div>
  )
}
