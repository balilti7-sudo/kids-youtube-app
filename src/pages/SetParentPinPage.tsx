import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { SafeTubeLogo } from '../components/branding/SafeTubeLogo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { isProfileParentPinMissing } from '../lib/parentPin'
import { requestPinEmail } from '../lib/requestPinEmail'

const pinSchema = z
  .string()
  .length(4, 'נא להזין 4 ספרות')
  .regex(/^\d{4}$/, 'הקוד חייב להכיל ספרות בלבד')

export function SetParentPinPage() {
  const { user, profile, loading, profileLoading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading || profileLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingSpinner className="h-10 w-10" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (!isProfileParentPinMissing(profile)) {
    return <Navigate to="/dashboard" replace />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const parsed = pinSchema.safeParse(pin)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'קוד לא תקין')
      return
    }

    setSaving(true)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ parent_pin: parsed.data })
      .eq('id', user.id)

    if (updateError) {
      setSaving(false)
      setError(updateError.message || 'שמירת קוד הורה נכשלה')
      return
    }

    requestPinEmail({
      email: profile?.email || user.email || '',
      pin: parsed.data,
      accessToken: null,
    })

    await refreshProfile()
    setSaving(false)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <SafeTubeLogo className="mb-4 h-11 w-auto max-w-[min(100%,260px)]" />
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-100">הגדרת קוד הורה</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">
          לפני כניסה לדשבורד, צריך להגדיר קוד הורה חד-פעמי. קוד זה נדרש לניהול הערוצים וההגדרות.
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">Parent PIN</label>
            <Input
              dir="ltr"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              onChange={(ev) => setPin(ev.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••"
              className="tracking-widest"
              autoFocus
            />
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {saving ? 'שומר…' : 'שמור והמשך לדשבורד'}
          </Button>
        </form>
      </div>
    </div>
  )
}
