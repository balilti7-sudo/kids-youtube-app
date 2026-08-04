import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { SafeTubeLogo } from '../components/branding/SafeTubeLogo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { isProfileParentPinMissing, PARENT_PIN_DIGIT_MAX } from '../lib/parentPin'
import { clearPendingParentPin, readPendingParentPin } from '../lib/pendingParentPin'
import { requestPinEmail } from '../lib/requestPinEmail'
import { setSkipParentalManagementGateOnce } from '../lib/parentalGateSkipOnce'

const pinSchema = z
  .string()
  .regex(/^\d+$/, 'הקוד חייב להכיל ספרות בלבד')
  .refine((s) => s.length === PARENT_PIN_DIGIT_MAX, {
    message: `הקוד חייב להכיל ${PARENT_PIN_DIGIT_MAX} ספרות`,
  })

export function SetParentPinPage() {
  const { user, profile, loading, profileLoading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const email = profile?.email || user?.email
    if (!email) return
    const pending = readPendingParentPin(email)
    if (pending) setPin(pending)
  }, [profile?.email, user?.email])

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
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ parent_pin: parsed.data })
        .eq('id', user.id)

      if (updateError) {
        setError(updateError.message || 'שמירת קוד הורה נכשלה')
        return
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const emailResult = await requestPinEmail({
          email: profile?.email || user.email || '',
          pin: parsed.data,
          accessToken: sessionData.session?.access_token ?? null,
        })
        if (!emailResult.ok && !emailResult.skipped) {
          console.warn('[SetParentPinPage] PIN email failed:', emailResult.error)
        }
      } catch (emailErr) {
        // PIN is already saved — never block dashboard entry on email/native-HTTP issues.
        console.warn('[SetParentPinPage] PIN email unexpected error:', emailErr)
      }

      clearPendingParentPin()
      await refreshProfile()
      setSkipParentalManagementGateOnce()
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[SetParentPinPage] save failed:', message)
      setError(message || 'שמירת קוד הורה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <SafeTubeLogo size="sm" className="mb-4" />
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-100">הגדרת קוד הורה</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">
          לפני כניסה לדשבורד, הגדירו קוד הורה ({PARENT_PIN_DIGIT_MAX} ספרות). אם בחרתם קוד בהרשמה — הוא
          מופיע למטה; אחרי השמירה נשלח אליכם מייל עם הקוד לשמירה.
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">קוד הורה</label>
            <Input
              dir="ltr"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={PARENT_PIN_DIGIT_MAX}
              value={pin}
              onChange={(ev) => setPin(ev.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))}
              placeholder="••••••"
              className="tracking-widest"
              autoFocus
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-zinc-500">
              {PARENT_PIN_DIGIT_MAX} ספרות בלבד.
            </p>
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
