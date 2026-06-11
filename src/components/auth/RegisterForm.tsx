import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { requestWelcomeEmail } from '../../lib/requestWelcomeEmail'
import { savePendingParentPin } from '../../lib/pendingParentPin'
import { PARENT_PIN_DIGIT_MAX } from '../../lib/parentPin'

const schema = z
  .object({
    email: z.string().min(1, 'נא למלא אימייל').email('אימייל לא תקין'),
    password: z.string().min(6, 'לפחות 6 תווים'),
    parentPin: z
      .string()
      .regex(/^\d+$/, 'קוד הורה — ספרות בלבד')
      .refine((s) => s.length === PARENT_PIN_DIGIT_MAX, {
        message: `קוד הורה: ${PARENT_PIN_DIGIT_MAX} ספרות`,
      }),
    confirmParentPin: z.string().min(1, 'אשרו את קוד ההורה'),
  })
  .refine((d) => d.parentPin === d.confirmParentPin, {
    message: 'קודי ההורה לא תואמים',
    path: ['confirmParentPin'],
  })

type Form = z.infer<typeof schema> & { fullName?: string }

export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const signUp = useAuthStore((s) => s.signUp)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [sentToEmail, setSentToEmail] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', confirmParentPin: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null)
    savePendingParentPin(values.email, values.parentPin)
    const { error, session } = await signUp(values.email, values.password)
    if (error) {
      console.error('[RegisterForm] signUp failed:', error.message, error)
      setSubmitError(error.message)
      return
    }
    requestWelcomeEmail({ email: values.email, accessToken: session?.access_token ?? null })
    setSentToEmail(values.email)
    setSuccess(true)
  })

  if (success) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-brand-700 dark:text-brand-400">
          שלחנו לך מייל אימות{sentToEmail ? ` ל־${sentToEmail}` : ''}. אנא אשר אותו כדי להתחבר.
        </p>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          קוד ההורה שבחרתם יישמר בחשבון אחרי ההתחברות הראשונה, ותקבלו גם מייל עם הקוד לשמירה.
        </p>
        <Button type="button" className="w-full" onClick={onSwitchToLogin}>
          מעבר להתחברות
        </Button>
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

      <div className="rounded-xl border border-brand-200/80 bg-brand-50/50 p-3 dark:border-brand-900/40 dark:bg-brand-950/20">
        <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-zinc-100">קוד הורה (ניהול ערוצים)</p>
        <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
          בחרו קוד בן {PARENT_PIN_DIGIT_MAX} ספרות. הוא יידרש לערוצים והגדרות, ויישלח אליכם במייל אחרי
          האימות.
        </p>
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-zinc-300">קוד הורה</label>
            <div className="relative">
              <Input
                dir="ltr"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="off"
                maxLength={PARENT_PIN_DIGIT_MAX}
                className="pr-11 tracking-widest"
                {...register('parentPin')}
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-500"
                aria-label={showPin ? 'הסתר קוד' : 'הצג קוד'}
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.parentPin ? <p className="mt-1 text-xs text-red-600">{errors.parentPin.message}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-zinc-300">אישור קוד הורה</label>
            <Input
              dir="ltr"
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              autoComplete="off"
              maxLength={PARENT_PIN_DIGIT_MAX}
              className="tracking-widest"
              {...register('confirmParentPin')}
            />
            {errors.confirmParentPin ? (
              <p className="mt-1 text-xs text-red-600">{errors.confirmParentPin.message}</p>
            ) : null}
          </div>
        </div>
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
