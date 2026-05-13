import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isValidParentPinDigits, PARENT_PIN_DIGIT_MAX, PARENT_PIN_DIGIT_MIN } from '../../lib/parentPin'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const WRONG_PASSWORD_HE = 'הסיסמה שגויה'

function isInvalidLoginCredentials(error: { message?: string; status?: number; code?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase()
  if (error.code === 'invalid_credentials') return true
  if (
    error.status === 400 &&
    (msg.includes('invalid login') ||
      msg.includes('invalid credential') ||
      msg.includes('invalid email or password'))
  ) {
    return true
  }
  return false
}

type Props = {
  open: boolean
  onClose: () => void
  /** After DB update + profile refresh */
  onSuccess: () => void
  userId: string
  userEmail: string
  refreshProfile: () => Promise<void>
}

/**
 * איפוס קוד הורה לאחר אימות סיסמת חשבון (Supabase Auth), כמו שינוי סיסמה בפרופיל.
 */
export function ParentalForgotPinModal({ open, onClose, onSuccess, userId, userEmail, refreshProfile }: Props) {
  const [accountPassword, setAccountPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setAccountPassword('')
    setNewPin('')
    setNewPinConfirm('')
    setBusy(false)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) resetForm()
  }, [open, resetForm])

  const handleSubmit = async () => {
    setError(null)
    if (!userId?.trim()) {
      setError('לא ניתן לאפס — חסר מזהה משתמש.')
      return
    }
    const email = userEmail.trim()
    if (!email) {
      setError('לא נמצאה כתובת אימייל לחשבון.')
      return
    }
    if (!accountPassword) {
      setError('נא להזין את סיסמת החשבון.')
      return
    }
    const digits = newPin.replace(/\D/g, '')
    if (!isValidParentPinDigits(digits)) {
      setError(`קוד ההורה חייב להכיל בין ${PARENT_PIN_DIGIT_MIN} ל-${PARENT_PIN_DIGIT_MAX} ספרות.`)
      return
    }
    if (digits !== newPinConfirm.replace(/\D/g, '')) {
      setError('הקוד החדש ואימות הקוד אינם תואמים.')
      return
    }

    setBusy(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: accountPassword,
      })
      if (authErr) {
        setError(isInvalidLoginCredentials(authErr) ? WRONG_PASSWORD_HE : authErr.message || 'אימות נכשל')
        return
      }

      const { error: upErr } = await supabase.from('profiles').update({ parent_pin: digits }).eq('id', userId)
      if (upErr) {
        setError(upErr.message || 'עדכון קוד ההורה נכשל')
        return
      }

      await refreshProfile()
      resetForm()
      onSuccess()
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
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
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
              <p className="text-xs text-slate-500 dark:text-zinc-400">אימות סיסמת החשבון, ואז קוד חדש</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            onClick={() => !busy && onClose()}
            aria-label="סגור"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
            הזינו את <strong className="text-slate-800 dark:text-zinc-200">סיסמת ההתחברות</strong> לאפליקציה (אותה
            סיסמה כמו במסך ההתחברות), ואז בחרו קוד הורה חדש בן {PARENT_PIN_DIGIT_MIN}–{PARENT_PIN_DIGIT_MAX} ספרות.
            אם נרשמתם עם Google בלבד ואין סיסמה, השתמשו ב־״שכחתי סיסמה״ במסך ההתחברות כדי להגדיר סיסמה, ואז חזרו לכאן.
          </p>

          <div>
            <label htmlFor="forgot-pin-account-password" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
              סיסמת חשבון
            </label>
            <Input
              id="forgot-pin-account-password"
              type="password"
              autoComplete="current-password"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              disabled={busy}
              placeholder="הסיסמה שלכם ב-SafeTube"
            />
          </div>

          <div>
            <label htmlFor="forgot-pin-new" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
              קוד הורה חדש
            </label>
            <Input
              id="forgot-pin-new"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={PARENT_PIN_DIGIT_MAX}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))}
              disabled={busy}
              placeholder={`${PARENT_PIN_DIGIT_MIN}–${PARENT_PIN_DIGIT_MAX} ספרות`}
              dir="ltr"
              className="text-center font-mono text-lg tracking-widest"
            />
          </div>

          <div>
            <label htmlFor="forgot-pin-confirm" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
              אימות קוד הורה
            </label>
            <Input
              id="forgot-pin-confirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={PARENT_PIN_DIGIT_MAX}
              value={newPinConfirm}
              onChange={(e) => setNewPinConfirm(e.target.value.replace(/\D/g, '').slice(0, PARENT_PIN_DIGIT_MAX))}
              disabled={busy}
              placeholder="הזינו שוב"
              dir="ltr"
              className="text-center font-mono text-lg tracking-widest"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" className="flex-1" disabled={busy} onClick={() => void handleSubmit()}>
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  שומרים…
                </span>
              ) : (
                'שמור קוד חדש'
              )}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={onClose}>
              ביטול
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
