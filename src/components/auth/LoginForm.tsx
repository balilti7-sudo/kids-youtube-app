import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

const schema = z.object({
  email: z.string().email('אימייל לא תקין'),
  password: z.string().min(6, 'סיסמה קצרה מדי'),
})

type Form = z.infer<typeof schema>

const LOGIN_FAILURE_COUNT_KEY = 'safetube_login_failure_count'
const LOGIN_FAILURE_CLEAR_THRESHOLD = 3

function clearPossiblyCorruptedSupabaseAuthToken() {
  try {
    const keysToDelete: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (!k) continue
      if (k.includes('supabase.auth.token') || /^sb-.*-auth-token$/.test(k)) {
        keysToDelete.push(k)
      }
    }
    keysToDelete.forEach((k) => window.localStorage.removeItem(k))
    if (keysToDelete.length > 0) {
      console.warn('[auth] cleared local Supabase token keys after repeated login failure', keysToDelete)
    }
  } catch {
    /* ignore */
  }
}

function registerLoginFailure() {
  try {
    const current = Number(window.sessionStorage.getItem(LOGIN_FAILURE_COUNT_KEY) || '0')
    const next = Number.isFinite(current) ? current + 1 : 1
    window.sessionStorage.setItem(LOGIN_FAILURE_COUNT_KEY, String(next))
    if (next >= LOGIN_FAILURE_CLEAR_THRESHOLD) {
      clearPossiblyCorruptedSupabaseAuthToken()
      window.sessionStorage.removeItem(LOGIN_FAILURE_COUNT_KEY)
    }
  } catch {
    /* ignore */
  }
}

function clearLoginFailureCounter() {
  try {
    window.sessionStorage.removeItem(LOGIN_FAILURE_COUNT_KEY)
  } catch {
    /* ignore */
  }
}

export function LoginForm({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
  const signIn = useAuthStore((s) => s.signIn)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    const { error } = await signIn(values.email, values.password)
    if (error) {
      registerLoginFailure()
      setSubmitError(error.message)
      return
    }
    clearLoginFailureCounter()
  })

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">אימייל</label>
        <Input dir="ltr" type="email" autoComplete="email" {...register('email')} />
        {errors.email ? <p className="mt-1 text-xs text-red-600">{errors.email.message}</p> : null}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">סיסמה</label>
        <div className="relative">
          <Input
            dir="ltr"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className="pr-11"
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-300"
            aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password ? <p className="mt-1 text-xs text-red-600">{errors.password.message}</p> : null}
      </div>
      {submitError ? <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p> : null}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" />
        ) : null}
        {isSubmitting ? 'מתחבר…' : 'התחברות'}
      </Button>
      <button
        type="button"
        onClick={onSwitchToRegister}
        className="w-full text-center text-sm font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
      >
        אין לך חשבון? הרשמה
      </button>
    </form>
  )
}
