import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

function getSafeNextFromUrl(locationSearch: string): string {
  const nextParam = new URLSearchParams(locationSearch).get('next')
  return nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/onboarding'
}

/**
 * Step 1 — rapid email entry: one field, Enter submits, optional 6-digit OTP after send.
 * Magic-link click also completes auth via redirect.
 */
export function EmailQuickAuthForm() {
  const { t } = useTranslation()
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink)
  const verifyEmailOtp = useAuthStore((s) => s.verifyEmailOtp)
  const location = useLocation()
  const emailId = useId()
  const codeId = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'email' | 'code'>('email')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const tFocus = window.setTimeout(() => {
      if (phase === 'email') emailRef.current?.focus()
      else codeRef.current?.focus()
    }, 80)
    return () => window.clearTimeout(tFocus)
  }, [phase])

  const sendLink = async () => {
    setSubmitError(null)
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setSubmitError(t('auth.invalidEmail'))
      return
    }
    setBusy(true)
    try {
      const safeNext = getSafeNextFromUrl(location.search)
      const emailRedirectTo = `${window.location.origin}/auth?next=${encodeURIComponent(safeNext)}`
      const { error } = await signInWithMagicLink(trimmed, emailRedirectTo)
      if (error) {
        setSubmitError(error.message)
        return
      }
      setPhase('code')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    setSubmitError(null)
    const trimmedEmail = email.trim()
    const token = code.replace(/\D/g, '').trim()
    if (token.length < 6) {
      setSubmitError(t('auth.invalidCode'))
      return
    }
    setBusy(true)
    try {
      const { error } = await verifyEmailOtp(trimmedEmail, token)
      if (error) {
        setSubmitError(error.message)
        return
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (phase === 'email') void sendLink()
        else void verifyCode()
      }}
    >
      <div>
        <label htmlFor={emailId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">
          {t('auth.email')}
        </label>
        <Input
          ref={emailRef}
          id={emailId}
          dir="ltr"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          enterKeyHint="go"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy || phase === 'code'}
          aria-invalid={Boolean(submitError)}
        />
      </div>

      {phase === 'code' ? (
        <div>
          <p className="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-100">
            {t('auth.checkEmailOrCode')}
          </p>
          <label htmlFor={codeId} className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">
            {t('auth.otpCode')}
          </label>
          <Input
            ref={codeRef}
            id={codeId}
            dir="ltr"
            type="text"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            maxLength={8}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            disabled={busy}
            aria-invalid={Boolean(submitError)}
          />
        </div>
      ) : null}

      {submitError ? (
        <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
          {submitError}
        </p>
      ) : null}

      <Button type="submit" disabled={busy} className="w-full text-base font-bold">
        {busy ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
        {busy
          ? t('auth.working')
          : phase === 'email'
            ? t('auth.continueWithEmail')
            : t('auth.verifyCode')}
      </Button>

      {phase === 'code' ? (
        <button
          type="button"
          className="min-h-12 text-sm font-semibold text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
          onClick={() => {
            setPhase('email')
            setCode('')
            setSubmitError(null)
          }}
          disabled={busy}
        >
          {t('auth.changeEmail')}
        </button>
      ) : null}
    </form>
  )
}
