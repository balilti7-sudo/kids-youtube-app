import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Shield } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useLocalParentManagement } from '../../hooks/useLocalParentManagement'
import { cn } from '../../lib/utils'
import { isEmergencyParentManagementBypass } from '../../lib/verifyParentProfilePin'
import { verifyParentManagementPin } from '../../lib/verifyParentManagementPin'
import { useAuthStore } from '../../stores/authStore'
import { Button } from '../ui/Button'

type DigitSlot = '' | string

/**
 * שכבת מסך מלאה — חובה להזין את קוד ההורה לפני גישה לאזור הניהול (דשבורד, ערוצים וכו׳).
 */
export function ParentalManagementGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { user, profile } = useAuth()
  const localParent = useLocalParentManagement()
  const signOut = useAuthStore((s) => s.signOut)

  const [digits, setDigits] = useState<[DigitSlot, DigitSlot, DigitSlot, DigitSlot]>(['', '', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const digitsRef = useRef(digits)
  digitsRef.current = digits
  const inFlightRef = useRef(false)

  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ] as const

  const resetDigits = useCallback(() => {
    setDigits(['', '', '', ''])
    setError(null)
    setVerifying(false)
    inFlightRef.current = false
  }, [])

  useEffect(() => {
    resetDigits()
    const t = window.setTimeout(() => refs[0].current?.focus(), 150)
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
      const lenOk = trimmed.length === 4 || isEmergencyParentManagementBypass(trimmed)
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
      setDigits(['', '', '', ''])
      window.requestAnimationFrame(() => refs[0].current?.focus())
    },
    [onUnlocked, verifyPin]
  )

  const handleChange = (index: number, raw: string) => {
    if (inFlightRef.current) return
    const ch = raw.replace(/\D/g, '').slice(-1) as DigitSlot

    setDigits((prev) => {
      const next: [DigitSlot, DigitSlot, DigitSlot, DigitSlot] = [...prev] as [
        DigitSlot,
        DigitSlot,
        DigitSlot,
        DigitSlot,
      ]
      next[index] = ch
      const pin = next.join('')
      queueMicrotask(() => {
        if (ch && index < 3) {
          refs[index + 1].current?.focus()
        }
        if (pin.length === 4) {
          void tryVerify(pin)
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
          const next = [...prev] as [DigitSlot, DigitSlot, DigitSlot, DigitSlot]
          next[index - 1] = ''
          return next
        })
        refs[index - 1].current?.focus()
      }
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      refs[index - 1].current?.focus()
    }
    if (e.key === 'ArrowRight' && index < 3) {
      e.preventDefault()
      refs[index + 1].current?.focus()
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
    const text = digitsOnly.slice(0, 4)
    if (!text) return
    const arr: [DigitSlot, DigitSlot, DigitSlot, DigitSlot] = ['', '', '', '']
    for (let i = 0; i < 4; i++) {
      arr[i] = (text[i] ?? '') as DigitSlot
    }
    setError(null)
    setDigits(arr)
    const pin = arr.join('')
    queueMicrotask(() => {
      const focusIdx = Math.min(text.length, 3)
      refs[focusIdx].current?.focus()
      if (pin.length === 4) void tryVerify(pin)
    })
  }

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
              כדי לגשת לדף הבית, לערוצים ולהגדרות — הזינו את קוד ההורה (4 ספרות) מהפרופיל. כשאתם מחוברים, הקוד נבדק מול מסד הנתונים (שדה parent_pin).
            </p>

            <div dir="ltr" className="flex justify-center gap-3" onPaste={handlePaste}>
              {([0, 1, 2, 3] as const).map((i) => (
                <input
                  key={i}
                  ref={refs[i]}
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={1}
                  disabled={verifying}
                  value={digits[i]}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  className={cn(
                    'h-14 w-12 rounded-xl border-2 bg-white/90 text-center text-xl font-semibold tracking-widest text-slate-900 shadow-inner',
                    'outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30',
                    'disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-100',
                    error ? 'border-red-400 dark:border-red-500/70' : 'border-slate-200 dark:border-zinc-600'
                  )}
                  aria-invalid={Boolean(error)}
                  aria-label={`ספרה ${i + 1} מתוך 4`}
                />
              ))}
            </div>

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
    </AnimatePresence>
  )
}
