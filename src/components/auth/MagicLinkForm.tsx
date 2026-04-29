import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

function getSafeNextFromUrl(locationSearch: string): string {
  const nextParam = new URLSearchParams(locationSearch).get('next')
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'
  return safeNext
}

export function MagicLinkForm() {
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink)
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const onSubmit = async () => {
    setSubmitError(null)
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setSubmitError('נא להכניס אימייל תקין')
      return
    }

    setSending(true)
    try {
      const safeNext = getSafeNextFromUrl(location.search)
      const emailRedirectTo = `${window.location.origin}/auth?next=${encodeURIComponent(safeNext)}`
      const { error } = await signInWithMagicLink(trimmed, emailRedirectTo)
      if (error) {
        setSubmitError(error.message)
        return
      }
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">אימייל</label>
        <Input dir="ltr" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {submitError ? <p className="mt-1 text-xs text-red-600">{submitError}</p> : null}
      </div>

      {sent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-100">
          בדקו את המייל שלכם. שלחנו קישור חד־פעמי לכניסה.
        </div>
      ) : (
        <Button type="button" disabled={sending} className="w-full" onClick={() => void onSubmit()}>
          {sending ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
          {sending ? 'שולח…' : 'שלח לי קישור'}
        </Button>
      )}
    </div>
  )
}

