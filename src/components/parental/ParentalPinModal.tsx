import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import { contiguousDigitsFromPinSlots, isValidParentPinDigits } from '../../lib/parentPin'
import { cn } from '../../lib/utils'
import { isEmergencyParentManagementBypass } from '../../lib/verifyParentProfilePin'
import type { ParentPinVerifyResult } from '../../lib/verifyParentProfilePin'
import { Button } from '../ui/Button'

type DigitSlot = '' | string
type SixDigit = [DigitSlot, DigitSlot, DigitSlot, DigitSlot, DigitSlot, DigitSlot]

const EMPTY_SIX: SixDigit = ['', '', '', '', '', '']

const SLOT_INDEXES = [0, 1, 2, 3, 4, 5] as const

export function ParentalPinModal({
  open,
  onClose,
  onVerified,
  verifyPin,
  title = 'אימות הורה',
  description = 'הזינו את קוד ההורה (4–6 ספרות). הפעולה תתבצע רק אחרי אימות מוצלח.',
}: {
  open: boolean
  onClose: () => void
  onVerified: (pin: string) => void
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
  title?: string
  description?: string
}) {
  const [digits, setDigits] = useState<SixDigit>(EMPTY_SIX)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const digitsRef = useRef(digits)
  digitsRef.current = digits
  const inFlightRef = useRef(false)

  const inputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null, null, null, null])

  const reset = useCallback(() => {
    setDigits(EMPTY_SIX)
    setError(null)
    setVerifying(false)
    inFlightRef.current = false
  }, [])

  useEffect(() => {
    if (!open) return
    reset()
    const t = window.setTimeout(() => inputRefs.current[0]?.focus(), 120)
    return () => window.clearTimeout(t)
  }, [open, reset])

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
        onVerified(trimmed)
        return
      }
      setError(result.errorMessage)
      setDigits(EMPTY_SIX)
      window.requestAnimationFrame(() => inputRefs.current[0]?.focus())
    },
    [onVerified, verifyPin]
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
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
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
  const canSubmitPin =
    isValidParentPinDigits(pinContiguous) || isEmergencyParentManagementBypass(pinContiguous)

  const modal = (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100010] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="סגור"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="parental-pin-title"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className={cn(
              'relative w-full max-w-md overflow-hidden rounded-3xl border border-yt-border',
              'bg-yt-surface shadow-2xl ring-1 ring-yt-border/80'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-yt-border px-5 py-4">
              <h2 id="parental-pin-title" className="text-lg font-bold text-yt-text">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200/80 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                aria-label="סגור"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-6">
              <p className="text-sm leading-relaxed text-yt-textMuted">{description}</p>

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
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
