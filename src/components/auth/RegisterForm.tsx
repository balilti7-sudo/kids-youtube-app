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
  email: z.string().min(1, 'נא למלא אימייל').email('אימייל לא תקין'),
  password: z.string().min(6, 'לפחות 6 תווים'),
})

type Form = z.infer<typeof schema> & { fullName?: string }

export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const signUp = useAuthStore((s) => s.signUp)
  const verifyEmailCode = useAuthStore((s) => s.verifyEmailCode)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    const { error } = await signUp(values.email, values.password)
    if (error) {
      console.error('[RegisterForm] signUp failed:', error.message, error)
      setSubmitError(error.message)
      return
    }
    setPendingEmail(values.email)
  })

  const onVerifyCode = async () => {
    if (!pendingEmail) return
    const code = verificationCode.trim()
    if (!/^\d{6}$/.test(code)) {
      setCodeError('יש להזין קוד אימות בן 6 ספרות')
      return
    }

    setCodeError(null)
    setVerifying(true)
    const { error } = await verifyEmailCode(pendingEmail, code)
    setVerifying(false)
    if (error) {
      setCodeError(error.message)
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-emerald-700 dark:text-emerald-400">האימייל אומת בהצלחה. אפשר להתחבר.</p>
        <Button type="button" className="w-full" onClick={onSwitchToLogin}>
          מעבר להתחברות
        </Button>
      </div>
    )
  }

  if (pendingEmail) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700 dark:text-zinc-300">
          שלחנו קוד אימות ל־<span dir="ltr">{pendingEmail}</span>. הזינו כאן את הקוד כדי להשלים הרשמה.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">קוד אימות</label>
          <Input
            dir="ltr"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            placeholder="123456"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            maxLength={6}
          />
          {codeError ? <p className="mt-1 text-xs text-red-600">{codeError}</p> : null}
        </div>
        <Button type="button" disabled={verifying} className="w-full" onClick={() => void onVerifyCode()}>
          {verifying ? (
            <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" />
          ) : null}
          {verifying ? 'מאמת…' : 'אימות קוד והשלמת הרשמה'}
        </Button>
        <button
          type="button"
          onClick={() => setPendingEmail(null)}
          className="w-full text-center text-sm font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
        >
          חזרה להרשמה
        </button>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">
          שם מלא <span className="font-normal text-slate-500 dark:text-zinc-500">(אופציונלי)</span>
        </label>
        <Input autoComplete="name" {...register('fullName')} />
      </div>
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
            autoComplete="new-password"
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
        {isSubmitting ? 'יוצר חשבון…' : 'הרשמה'}
      </Button>
      <button
        type="button"
        onClick={onSwitchToLogin}
        className="w-full text-center text-sm font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-400"
      >
        כבר רשום? התחברות
      </button>
    </form>
  )
}
