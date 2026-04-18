import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const MIN_PASSWORD_LEN = 8

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

export function ProfilePage() {
  const { user, refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    setEmail(user?.email ?? '')
  }, [user?.email])

  const handleEmailUpdate = async () => {
    const next = email.trim()
    if (!isValidEmail(next)) {
      toast.error('נא להזין כתובת אימייל תקינה')
      return
    }
    setEmailSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: next })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('בקשת עדכון האימייל נשלחה. ייתכן שתצטרכו לאשר בקישור שנשלח לתיבה.')
      await refreshProfile()
    } finally {
      setEmailSaving(false)
    }
  }

  const handlePasswordUpdate = async () => {
    if (password.length < MIN_PASSWORD_LEN) {
      toast.error(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`)
      return
    }
    if (password !== passwordConfirm) {
      toast.error('הסיסמאות אינן תואמות')
      return
    }
    setPasswordSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success('הסיסמה עודכנה')
      setPassword('')
      setPasswordConfirm('')
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">חשבון והתחברות</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">עדכון אימייל וסיסמה (Supabase Auth)</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">שינוי אימייל</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
          אחרי השמירה ייתכן שתתבקשו לאשר את הכתובת החדשה במייל (לפי הגדרות Supabase).
        </p>
        <Input
          type="email"
          dir="ltr"
          className="mt-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <Button className="mt-3 w-full" disabled={emailSaving} onClick={() => void handleEmailUpdate()}>
          {emailSaving ? 'שומר…' : 'עדכן אימייל'}
        </Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">שינוי סיסמה</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">לפחות {MIN_PASSWORD_LEN} תווים.</p>
        <Input
          type="password"
          dir="ltr"
          className="mt-3"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="סיסמה חדשה"
          autoComplete="new-password"
        />
        <Input
          type="password"
          dir="ltr"
          className="mt-2"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          placeholder="אימות סיסמה"
          autoComplete="new-password"
        />
        <Button className="mt-3 w-full" disabled={passwordSaving} onClick={() => void handlePasswordUpdate()}>
          {passwordSaving ? 'מעדכן…' : 'עדכן סיסמה'}
        </Button>
      </section>
    </div>
  )
}
