import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreditCard, Info, LogOut, UserCircle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSubscription } from '../../hooks/useSubscription'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { BridgeStatusBadge } from './BridgeStatusBadge'
import { toast } from 'sonner'

const linkItems = [
  { to: '/profile', label: 'חשבון והתחברות', icon: UserCircle },
  { to: '/subscription', label: 'ניהול מנוי', icon: CreditCard },
] as const

export function SettingsPanel() {
  const navigate = useNavigate()
  const [aboutOpen, setAboutOpen] = useState(false)
  const { user, profile, signOutClearEverything, refreshProfile } = useAuth()
  const { subscription } = useSubscription(user?.id)
  const showDevTools = import.meta.env.DEV

  const handleLogout = async () => {
    await signOutClearEverything()
    navigate('/auth', { replace: true })
  }

  const handleDevResetParentPin = async () => {
    if (!user?.id) return
    const { error } = await supabase.from('profiles').update({ parent_pin: null }).eq('id', user.id)
    if (error) {
      toast.error(error.message || 'איפוס parent_pin נכשל')
      return
    }
    await refreshProfile()
    toast.success('parent_pin אופס ל-NULL. מעביר למסך הגדרת PIN.')
    navigate('/set-parent-pin', { replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-4">
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
        {linkItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={label}
            to={to}
            className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 text-slate-800 last:border-0 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Icon className="h-5 w-5 text-slate-500 dark:text-zinc-500" />
            <span className="font-medium">{label}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-right text-slate-800 last:border-0 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Info className="h-5 w-5 shrink-0 text-slate-500 dark:text-zinc-500" />
          <span className="font-medium">אודות</span>
        </button>
      </nav>

      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="🛡️ אודות SafeTube"
        size="lg"
        bodyClassName="max-h-[75vh] overflow-y-auto text-right"
        footer={
          <Button type="button" variant="secondary" className="min-w-[7rem]" onClick={() => setAboutOpen(false)}>
            סגור
          </Button>
        }
      >
        <div dir="rtl" className="space-y-5 text-[15px] leading-relaxed text-slate-700 dark:text-zinc-300">
          <p className="text-base font-semibold text-slate-900 dark:text-zinc-100">החזון שלנו: סביבה דיגיטלית בטוחה באמת.</p>
          <p>
            SafeTube נולדה מתוך צורך אמיתי של הורים להחזיר את השליטה לידיים שלהם. בעידן שבו הילדים שלנו מופצצים בתוכן לא
            מבוקר ובפרסומות אגרסיביות, יצרנו מרחב שמאפשר להם ליהנות מהתכנים שהם אוהבים – ללא הסחות דעת וללא סיכונים
            מיותרים.
          </p>
          <div>
            <p className="mb-3 font-semibold text-slate-900 dark:text-zinc-100">מה הופך אותנו למיוחדים?</p>
            <ul className="list-disc space-y-2 pr-5 marker:text-brand-600 dark:marker:text-brand-500">
              <li>
                <span className="font-medium text-slate-900 dark:text-zinc-100">אפס פרסומות:</span> חוויית צפייה נקייה
                לחלוטין, כדי שהילדים לא ייחשפו לתוכן שיווקי לא מותאם.
              </li>
              <li>
                <span className="font-medium text-slate-900 dark:text-zinc-100">הגנה מובנית:</span> סינון קפדני של
                תכנים המבטיח שרק מה שמתאים לערכים שלכם ייכנס למסך.
              </li>
              <li>
                <span className="font-medium text-slate-900 dark:text-zinc-100">שקט נפשי להורים:</span> אנחנו כאן כדי
                לוודא שהזמן של הילדים מול המסך יהיה איכותי, בטוח ומהנה.
              </li>
            </ul>
          </div>
          <p className="text-sm text-slate-600 dark:text-zinc-400">
            אנו מחויבים לשיפור מתמיד של ההגנה על דור העתיד שלנו.
          </p>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-zinc-700 dark:bg-zinc-950/60">
            <p className="mb-2 font-semibold text-slate-900 dark:text-zinc-100">📧 צריכים עזרה? אנחנו כאן לכל שאלה:</p>
            <p className="mb-2 text-sm">לשירות לקוחות ותמיכה טכנית, שלחו לנו מייל לכתובת:</p>
            <a
              href="mailto:support@safetube.co.il"
              className="inline-block font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
              dir="ltr"
            >
              support@safetube.co.il
            </a>
          </div>
        </div>
      </Modal>

      <BridgeStatusBadge />

      {showDevTools ? (
        <section className="rounded-2xl border border-amber-300/80 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-950/30">
          <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">Dev Tools</h2>
          <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-100/90">
            איפוס זמני לזרימת SetParentPinPage: מאפס את parent_pin ב-profile הנוכחי ל-NULL.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => void handleDevResetParentPin()}
            disabled={!user}
          >
            אפס parent_pin שלי ל-NULL
          </Button>
        </section>
      ) : null}

      <Button variant="danger" className="w-full gap-2" onClick={() => void handleLogout()}>
        <LogOut className="h-5 w-5" />
        התנתקות (כולל טוקן ילד מקומי)
      </Button>
    </div>
  )
}
