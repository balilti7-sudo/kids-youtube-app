import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

const schema = z.object({
  email: z.string().email('אימייל לא תקין'),
  password: z.string().min(6, 'סיסמה קצרה מדי'),
})

type Form = z.infer<typeof schema>

export function LoginForm({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
  const signIn = useAuthStore((s) => s.signIn)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    const { error } = await signIn(values.email, values.password)
    if (error) setSubmitError(error.message)
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
        <Input dir="ltr" type="password" autoComplete="current-password" {...register('password')} />
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
