import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isValidParentPinDigits, PARENT_PIN_DIGIT_MAX, PARENT_PIN_DIGIT_MIN } from '../../lib/parentPin'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const WRONG_PASSWORD_HE = 'הסיסמה שגויה'

/** Dev always; production when env is set, or when `PARENT_PIN_FORGOT_SHOW_SKIP_IN_PROD` is true (revert after one-off). */
const PARENT_PIN_FORGOT_SHOW_SKIP_IN_PROD = false

const SHOW_PARENT_PIN_FORGOT_SKIP_VERIFY =
  import.meta.env.DEV ||
  import.meta.env.VITE_PARENT_PIN_FORGOT_SKIP_VERIFY === '1' ||
  import.meta.env.VITE_PARENT_PIN_FORGOT_SKIP_VERIFY === 'true' ||
  PARENT_PIN_FORGOT_SHOW_SKIP_IN_PROD

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

function buildForgotPinOtpRedirectUrl(): string {
  const fromEnv = import.meta.env.VITE_AUTH_SIGNUP_REDIRECT_TO?.trim()
  if (fromEnv) return fromEnv
  return `${window.location.origin}/auth?next=${encodeURIComponent('/dashboard')}`
}

type Props = {
  open: boolean
  onClose: () => void
  /** After DB update + profile refresh */
  onSuccess: () => void
  userId: string
  userEmail: string
  /** Google / OAuth-only: no local password — email OTP instead of password field */
  useEmailOtpInsteadOfPassword: boolean
  refreshProfile: () => Promise<void>
}

/**
 * איפוס קוד הורה לאחר אימות סיסמת חשבון או קוד מאימייל (Supabase Auth), כמו שינוי סיסמה בפרופיל.
 */
export function ParentalForgotPinModal({
  open,
  onClose,
  onSuccess,
  userId,
  userEmail,
  useEmailOtpInsteadOfPassword,
  refreshProfile,
}: Props) {
  const setSession = useAuthStore((s) => s.setSession)
  const fetchProfile = useAuthStore((s) => s.fetchProfile)

  const [accountPassword, setAccountPassword] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPinConfirm, setNewPinConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [otpSent, setOtpSent] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [accountReauthVerified, setAccountReauthVerified] = useState(false)
  /** null = probing Supabase session vs userId */
  const [activeSessionMatches, setActiveSessionMatches] = useState<boolean | null>(null)

  const resetForm = useCallback(() => {
    setAccountPassword('')
    setNewPin('')
    setNewPinConfirm('')
    setBusy(false)
    setError(null)
    setOtpSent(false)
    setOtpCode('')
    setAccountReauthVerified(false)
    setActiveSessionMatches(null)
  }, [])

  useEffect(() => {
    if (!open) resetForm()
  }, [open, resetForm])

  useEffect(() => {
    if (!open || !useEmailOtpInsteadOfPassword || !userId?.trim()) {
      setActiveSessionMatches(null)
      return
    }
    let cancelled = false
    setActiveSessionMatches(null)
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setActiveSessionMatches(session?.user?.id === userId)
    })
    return () => {
      cancelled = true
    }
  }, [open, useEmailOtpInsteadOfPassword, userId])

  const pinFieldsLocked = useEmailOtpInsteadOfPassword && !accountReauthVerified

  const handleSendEmailOtp = async () => {
    setError(null)
    const email = userEmail.trim()
    if (!email) {
      setError('לא נמצאה כתובת אימייל לחשבון.')
      return
    }
    setBusy(true)
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: buildForgotPinOtpRedirectUrl(),
        },
      })
      if (otpErr) {
        setError(otpErr.message || 'שליחת האימייל נכשלה')
        return
      }
      setOtpSent(true)
    } finally {
      setBusy(false)
    }
  }

  const handleVerifyEmailOtp = async () => {
    setError(null)
    const email = userEmail.trim()
    const token = otpCode.replace(/\s/g, '')
    if (!email) {
      setError('לא נמצאה כתובת אימייל לחשבון.')
      return
    }
    if (!token) {
      setError('נא להזין את הקוד מהאימייל.')
      return
    }
    setBusy(true)
    try {
      const { data, error: vErr } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      })
      if (vErr) {
        setError(vErr.message || 'קוד שגוי או שפג תוקפו')
        return
      }
      if (data.session) {
        setSession(data.session)
        void fetchProfile()
      }
      const verifiedUserId = data.user?.id ?? data.session?.user?.id
      if (!verifiedUserId) {
        setError('האימות לא החזיר סשן — נסו שוב או בקשו קוד חדש.')
        return
      }
      if (verifiedUserId !== userId) {
        setError('האימות התאים לחשבון אחר. נסו שוב עם אותו מייל של החשבון המחובר.')
        return
      }
      setAccountReauthVerified(true)
    } finally {
      setBusy(false)
    }
  }

  const handleDevForceReauth = () => {
    setError(null)
    setAccountReauthVerified(true)
  }

  const handleContinueWithActiveSession = async () => {
    setError(null)
    setBusy(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.user?.id === userId) {
        setAccountReauthVerified(true)
        return
      }
      setError('לא נמצא סשן פעיל שמתאים לחשבון הזה.')
    } finally {
      setBusy(false)
    }
  }

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

    if (useEmailOtpInsteadOfPassword) {
      if (!accountReauthVerified) {
        setError('נא ללחוץ ״אשר לפי חיבור קיים״ או לאמת לפי המייל לפני שמירת קוד ההורה.')
        return
      }
    } else {
      if (!accountPassword) {
        setError('נא להזין את סיסמת החשבון.')
        return
      }
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
      if (!useEmailOtpInsteadOfPassword) {
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email,
          password: accountPassword,
        })
        if (authErr) {
          setError(isInvalidLoginCredentials(authErr) ? WRONG_PASSWORD_HE : authErr.message || 'אימות נכשל')
          return
        }
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
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    {useEmailOtpInsteadOfPassword ? 'אישור חיבור קיים, ואז קוד חדש' : 'אימות סיסמת החשבון, ואז קוד חדש'}
                  </p>
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
              {useEmailOtpInsteadOfPassword ? (
                <>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                    החשבון מחובר בלי סיסמה מקומית (למשל Google). אם <strong className="text-slate-800 dark:text-zinc-200">כבר מחוברים כאן</strong> עם אותו
                    משתמש — לחצו ״אשר לפי חיבור קיים״ כדי לפתוח את שדות קוד ההורה החדש בלי מייל (מומלץ כשהמייל שולח רק קישור).
                  </p>

                  {accountReauthVerified ? (
                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                      האימות הצליח — ניתן לבחור קוד הורה חדש.
                    </p>
                  ) : activeSessionMatches === null ? (
                    <p className="flex items-center justify-center gap-2 text-center text-sm text-slate-500 dark:text-zinc-400">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      בודקים חיבור פעיל…
                    </p>
                  ) : activeSessionMatches ? (
                    <Button
                      type="button"
                      className="w-full"
                      disabled={busy}
                      onClick={() => void handleContinueWithActiveSession()}
                    >
                      אשר לפי חיבור קיים
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
                        לא זוהה סשן שמתאים למשתמש הזה במכשיר. אם אתם בכל זאת מחוברים — לחצו למטה. אחרת התחברו מחדש עם Google, או השתמשו באימות במייל (מתקדם).
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        disabled={busy}
                        onClick={() => void handleContinueWithActiveSession()}
                      >
                        אשר לפי חיבור קיים
                      </Button>
                    </div>
                  )}

                  {!accountReauthVerified ? (
                    <details className="group rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
                      <summary className="cursor-pointer select-none text-sm font-medium text-slate-700 outline-none marker:text-slate-400 dark:text-zinc-300">
                        אימות במייל (אופציונלי — לעיתים נשלח רק קישור)
                      </summary>
                      <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-zinc-700">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          disabled={busy}
                          onClick={() => void handleSendEmailOtp()}
                        >
                          {otpSent ? 'שלחו שוב קוד או קישור למייל' : 'שלחו קוד או קישור למייל'}
                        </Button>
                        {otpSent ? (
                          <p className="text-center text-xs text-slate-500 dark:text-zinc-400">
                            נשלח אימייל. אם יש קוד — הזינו למטה. אם רק קישור — השתמשו ב״אשר לפי חיבור קיים״ למעלה אחרי שחזרתם לאפליקציה.
                          </p>
                        ) : null}
                        <div className="space-y-2">
                          <label htmlFor="forgot-pin-email-otp" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-zinc-300">
                            קוד מהאימייל
                          </label>
                          <Input
                            id="forgot-pin-email-otp"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\s/g, ''))}
                            disabled={busy}
                            placeholder="הדביקו את הקוד"
                            dir="ltr"
                            className="text-center font-mono text-lg tracking-widest"
                          />
                          <Button type="button" className="w-full" disabled={busy || !otpSent} onClick={() => void handleVerifyEmailOtp()}>
                            אמתו קוד
                          </Button>
                        </div>
                      </div>
                    </details>
                  ) : null}

                  {SHOW_PARENT_PIN_FORGOT_SKIP_VERIFY ? (
                    <div className="border-t border-dashed border-amber-300 pt-3 dark:border-amber-800">
                      <p className="mb-2 text-center text-xs text-amber-800 dark:text-amber-200">
                        {import.meta.env.DEV
                          ? 'מצב פיתוח'
                          : PARENT_PIN_FORGOT_SHOW_SKIP_IN_PROD
                            ? 'דילוג לפי קבוע זמני בקוד — החזירו ל־false ופרסמו מחדש'
                            : 'מצב חירום לפי משתנה סביבה — הסירו VITE_PARENT_PIN_FORGOT_SKIP_VERIFY אחרי השימוש'}
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full border-amber-300 text-amber-950 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-950/40"
                        disabled={busy}
                        onClick={handleDevForceReauth}
                      >
                        דילוג על אימות
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
                    הזינו את <strong className="text-slate-800 dark:text-zinc-200">סיסמת ההתחברות</strong> לאפליקציה (אותה
                    סיסמה כמו במסך ההתחברות), ואז בחרו קוד הורה חדש בן {PARENT_PIN_DIGIT_MIN}–{PARENT_PIN_DIGIT_MAX} ספרות.
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
                </>
              )}

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
                  disabled={busy || pinFieldsLocked}
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
                  disabled={busy || pinFieldsLocked}
                  placeholder="הזינו שוב"
                  dir="ltr"
                  className="text-center font-mono text-lg tracking-widest"
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                >
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <Button type="button" className="flex-1" disabled={busy || pinFieldsLocked} onClick={() => void handleSubmit()}>
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
