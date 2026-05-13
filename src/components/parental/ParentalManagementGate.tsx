import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Shield } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { contiguousDigitsFromPinSlots, isValidParentPinDigits } from '../../lib/parentPin'
import { cn } from '../../lib/utils'
import { isEmergencyParentManagementBypass } from '../../lib/verifyParentProfilePin'
import { userRequiresEmailOtpForParentPinForgot } from '../../lib/parentPinForgotReauth'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../ui/Button'
import { ParentalForgotPinModal } from './ParentalForgotPinModal'

type DigitSlot = '' | string
type SixDigit = [DigitSlot, DigitSlot, DigitSlot, DigitSlot, DigitSlot, DigitSlot]

const EMPTY_SIX: SixDigit = ['', '', '', '', '', '']

const SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const

/**
 * שכבת מסך מלאה — חובה להזין את קוד ההורה לפני גישה לאזור הניהול (דשבורד, ערוצים וכו׳).
 */
export function ParentalManagementGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { user, profile, refreshProfile } = useAuth()
  const localParent = useLocalParentManagement()
  const signOut = useAuthStore((s) => s.signOut)

  const [digits, setDigits] = useState<SixDigit>(EMPTY_SIX)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [forgotPinOpen, setForgotPinOpen] = useState(false)
  const digitsRef = useRef(digits)
  digitsRef.current = digits
  const inFlightRef = useRef(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null])

  const resetDigits = useCallback(() => {
    setDigits(EMPTY_SIX)
    setError(null)
    setVerifying(false)
    inFlightRef.current = false
  }, [])

  useEffect(() => {
    resetDigits()
    const t = window.setTimeout(() => inputRefs.current[0]?.focus(), 150)
    return () => window.clearTimeout(t)
  }, [resetDigits])

  const verifyPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin },
        },
        pin
      ),
    [user?.id, profile, localParent]
  )

  const tryVerify = useCallback(
    async (full: string) => {
      const trimmed = full.replace(/\D/g, '').trim()
      const lenOk =
        isValidParentPinDigits(trimmed) || isEmergencyParentManagementBypass(trimmed)
      if (!lenOk || inFlightRef.current) return
      inFlightRef.current = true
      setVerifying(true)
      setError(null)
      const result = await verifyPin(trimmed)
      inFlightRef.current = false
      setVerifying(false)
      if (result.ok) {
        onUnlocked()
        return
      }
      setError(result.errorMessage)
      setDigits(EMPTY_SIX)
      window.requestAnimationFrame(() => inputRefs.current[0]?.focus())
    },
    [onUnlocked, verifyPin]
  )

  const handleChange = (index: number, raw: string) => {
    if (inFlightRef.current) return
    const ch = raw.replace(/\D/g, '').slice(-1) as DigitSlot

    setDigits((prev) => {
      const next = [...prev] as SixDigit
      next[index] = ch
      queueMicrotask(() => {
        if (ch && index < 5) {
          inputRefs.current[index + 1]?.focus()
        }
      })
      return next
    })
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digitsRef.current[index]) return
      e.preventDefault()
      if (index > 0) {
        setDigits((prev) => {
          const next = [...prev] as SixDigit
          next[index - 1] = ''
          return next
        })
        inputRefs.current[index - 1]?.focus()
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    if (inFlightRef.current) return
    const digitsOnly = e.clipboardData.getData('text').replace(/\D/g, '')
    if (isEmergencyParentManagementBypass(digitsOnly)) {
      void tryVerify(digitsOnly)
      return
    }
    const text = digitsOnly.slice(0, 6)
    if (!text) return
    const arr: SixDigit = ['', '', '', '', '', '']
    for (let i = 0; i < 6; i++) {
      arr[i] = (text[i] ?? '') as DigitSlot
    }
    setError(null)
    setDigits(arr)
    queueMicrotask(() => {
      const focusIdx = Math.min(text.length, 5)
      inputRefs.current[focusIdx]?.focus()
    })
  }

  const pinContiguous = contiguousDigitsFromPinSlots(digits)
  const canSubmitPin = isValidParentPinDigits(pinContiguous) || isEmergencyParentManagementBypass(pinContiguous)
  const canUseForgotPin = Boolean(user?.id && user?.email?.trim())

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[200] flex min-h-dvh flex-col items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-xl dark:bg-black/70"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        role="presentation"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="parental-gate-title"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          className={cn(
            'relative w-full max-w-md overflow-hidden rounded-2xl border border-white/20',
            'bg-white/80 shadow-2xl shadow-slate-900/20 ring-1 ring-white/30 backdrop-blur-2xl',
            'dark:border-white/10 dark:bg-zinc-900/80 dark:ring-white/5'
          )}
        >
          <div className="border-b border-slate-200/80 px-5 py-4 dark:border-zinc-700/80">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-400">
                <Shield className="h-6 w-6" aria-hidden />
              </div>
              <div>
                <h1 id="parental-gate-title" className="text-lg font-bold text-slate-900 dark:text-zinc-50">
                  כניסה לאזור ניהול
                </h1>
                <p className="text-xs text-slate-500 dark:text-zinc-500">נדרש קוד הורה מהפרופיל</p>
              </div>
            </div>
          </div>

          <div className="space-y-5 px-5 py-6">
            <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
              כדי לגשת לדף הבית, לערוצים ולהגדרות — הזינו את קוד ההורה (4–6 ספרות) מהפרופיל. כשאתם מחוברים, הקוד נבדק מול מסד הנתונים (שדה parent_pin).
            </p>

            <div dir="ltr" className="flex flex-wrap justify-center gap-2" onPaste={handlePaste}>
              {SLOT_INDEXES.map((i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el
                  }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  disabled={verifying}
                  value={digits[i]}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={cn(
                    'h-12 w-10 rounded-xl border-2 bg-white/90 text-center text-lg font-semibold tracking-widest text-slate-900 shadow-inner sm:h-14 sm:w-11',
                    'outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
                    'disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-100',
                    error ? 'border-red-400 dark:border-red-500/70' : 'border-slate-200 dark:border-zinc-600'
                  )}
                  aria-invalid={Boolean(error)}
                  aria-label={`ספרה ${i + 1} מתוך 6`}
                />
              ))}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={verifying || !canSubmitPin}
              onClick={() => void tryVerify(pinContiguous)}
            >
              אישור
            </Button>

            {canUseForgotPin ? (
              <div className="text-center">
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => setForgotPinOpen(true)}
                  className={cn(
                    'text-sm font-medium text-brand-600 underline-offset-2 hover:underline',
                    'disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-400'
                  )}
                >
                  שכחתי קוד
                </button>
              </div>
            ) : null}

            {verifying ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-600 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                מאמתים…
              </div>
            ) : null}

            {error ? (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              >
                {error}
              </motion.p>
            ) : null}

            <div className="border-t border-slate-200/80 pt-4 dark:border-zinc-700/80">
              <Button type="button" variant="secondary" className="w-full" onClick={() => void signOut()}>
                התנתקות
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      <ParentalForgotPinModal
        open={forgotPinOpen}
        onClose={() => setForgotPinOpen(false)}
        onSuccess={() => {
          setForgotPinOpen(false)
          onUnlocked()
        }}
        userId={user?.id ?? ''}
        userEmail={user?.email ?? ''}
        useEmailOtpInsteadOfPassword={userRequiresEmailOtpForParentPinForgot(user)}
        refreshProfile={refreshProfile}
      />
    </AnimatePresence>
  )
}
