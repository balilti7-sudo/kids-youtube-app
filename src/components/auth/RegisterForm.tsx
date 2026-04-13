import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
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
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
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
    }
    else setSuccess(true)
  })

  if (success) {
    return (
      <p className="text-center text-sm text-emerald-700 dark:text-emerald-400">
        נשלח מייל אימות (אם נדרש). אפשר להתחבר.
      </p>
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
        <Input dir="ltr" type="password" autoComplete="new-password" {...register('password')} />
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
