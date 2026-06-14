import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Loader2, Mail, X } from 'lucide-react'
import { requestParentPinResetEmail } from '../../lib/requestParentPinResetEmail'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

type Props = {
  open: boolean
  onClose: () => void
  /** Pre-fill when known from Supabase session */
  defaultEmail?: string
  /** When true, email is read-only (logged-in parent on management gate) */
  lockEmail?: boolean
}

/**
 * Forgot parent PIN: email-only reset. New PIN is generated server-side and sent by email.
 * Manual PIN change lives under Settings (after full parent login).
 */
export function ParentalForgotPinModal({ open, onClose, defaultEmail = '', lockEmail = false }: Props) {
  const [email, setEmail] = useState(defaultEmail)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const resetForm = useCallback(() => {
    setEmail(defaultEmail)
    setBusy(false)
    setError(null)
    setDone(false)
  }, [defaultEmail])

  useEffect(() => {
    if (!open) resetForm()
    else setEmail(defaultEmail)
  }, [open, defaultEmail, resetForm])

  const handleSend = async () => {
    setError(null)
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('נא להזין כתובת אימייל תקינה.')
      return
    }
    setBusy(true)
    try {
      const result = await requestParentPinResetEmail(trimmed)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="forgot-pin-backdrop"
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-parent-pin-title"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className={cn(
              'relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl',
              'dark:border-zinc-700 dark:bg-zinc-900'
            )}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400">
                  <KeyRound className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <h2 id="forgot-parent-pin-title" className="text-base font-bold text-slate-900 dark:text-zinc-50">
                    שכחתי קוד הורה
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">איפוס מאובטח במייל</p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                onClick={() => !busy && onClose()}
                aria-label="סגור"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {done ? (
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <Mail className="h-6 w-6" aria-hidden />
                  </div>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
                    אם האימייל <strong dir="ltr">{email.trim()}</strong> רשום אצלנו, נשלח אליכם מייל עם{' '}
                    <strong>קוד הורה חדש</strong>. בדקו גם בתיקיית ספאם.
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-500">
                    לאחר שקיבלתם את הקוד — הזינו אותו כאן למעלה. לשינוי קוד ידני: התחברו לחשבון → הגדרות.
                  </p>
                  <Button type="button" className="w-full" onClick={onClose}>
                    סגור
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                    {lockEmail
                      ? 'נשלח קוד הורה חדש בן 6 ספרות לכתובת האימייל של החשבון המחובר.'
                      : 'נשלח לכתובת האימייל של חשבון ההורה קוד חדש (נוצר אוטומטית בשרת). לא מזינים כאן סיסמה או קוד חדש — רק מבקשים מייל.'}
                  </p>
                  <div>
                    <label htmlFor="forgot-pin-email" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
                      אימייל חשבון ההורה
                    </label>
                    <Input
                      id="forgot-pin-email"
                      type="email"
                      autoComplete="email"
                      dir="ltr"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy || lockEmail}
                      readOnly={lockEmail}
                      placeholder="parent@example.com"
                      onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
                    />
                  </div>
                  {error ? (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                      {error}
                    </p>
                  ) : null}
                  <Button type="button" className="w-full" disabled={busy} onClick={() => void handleSend()}>
                    {busy ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        שולחים…
                      </span>
                    ) : (
                      'שלחו לי קוד חדש במייל'
                    )}
                  </Button>
                  <p className="text-center text-xs text-slate-500 dark:text-zinc-500">
                    לשינוי קוד אחרי התחברות: הגדרות → קוד PIN לנעילת הורים
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
