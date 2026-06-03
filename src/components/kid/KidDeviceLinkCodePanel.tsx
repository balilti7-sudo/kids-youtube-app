import { useCallback, useEffect, useState } from 'react'
import { Link2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useChildProofLongPress } from '../../hooks/useChildProofLongPress'
import {
  childGenerateDeviceLinkCode,
  formatDeviceLinkCode,
  mapDeviceLinkErrorMessage,
  type DeviceLinkCode,
} from '../../lib/deviceLinkPairing'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { cn } from '../../lib/utils'

function formatRemainingMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function KidDeviceLinkCodePanel({ className }: { className?: string }) {
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [linkCode, setLinkCode] = useState<DeviceLinkCode | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)

  const generateCode = useCallback(async () => {
    setLoading(true)
    const { data, error } = await childGenerateDeviceLinkCode()
    setLoading(false)
    if (error || !data) {
      toast.error(mapDeviceLinkErrorMessage(error))
      return
    }
    setLinkCode(data)
    setRemainingMs(Math.max(0, Date.parse(data.expiresAt) - Date.now()))
  }, [])

  const revealAndGenerate = useCallback(() => {
    setRevealed(true)
    void generateCode()
  }, [generateCode])

  const longPress = useChildProofLongPress({
    enabled: !revealed,
    durationMs: 3000,
    onComplete: revealAndGenerate,
  })

  useEffect(() => {
    if (!linkCode) return
    const tick = window.setInterval(() => {
      const ms = Date.parse(linkCode.expiresAt) - Date.now()
      setRemainingMs(ms)
      if (ms <= 0) {
        setLinkCode(null)
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [linkCode])

  if (!revealed) {
    return (
      <section
        className={cn(
          'rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/80 p-4 text-center dark:border-zinc-700 dark:bg-zinc-900/40',
          longPress.shaking && 'animate-child-proof-shake',
          className
        )}
        aria-label="קישור מכשיר לחשבון הורה"
      >
        <p className="text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
          {longPress.showHint
            ? 'המשיכו להחזיק…'
            : 'החזיקו 3 שניות כדי לקבל קוד קישור לחשבון הורה'}
        </p>
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          {...longPress.handlers}
        >
          <Link2 className="h-4 w-4" aria-hidden />
          קוד קישור (נסתר)
        </button>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-sky-200/80 bg-gradient-to-b from-sky-50 to-white p-4 dark:border-sky-900/50 dark:from-sky-950/40 dark:to-zinc-900/90',
        className
      )}
      aria-live="polite"
    >
      <h3 className="text-sm font-bold text-slate-800 dark:text-zinc-100">קוד קישור לחשבון הורה</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
        הזינו את הקוד הזה בלוח הבקרה של ההורה תוך 5 דקות. הקוד יימחק אחרי שימוש או כשהזמן נגמר.
      </p>

      {loading ? (
        <div className="mt-4 flex justify-center">
          <LoadingSpinner className="h-8 w-8 border-2 border-sky-500 border-t-transparent" />
        </div>
      ) : linkCode ? (
        <div className="mt-4 rounded-2xl border border-sky-200 bg-white px-4 py-5 text-center shadow-sm dark:border-sky-900/40 dark:bg-zinc-950/60">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-sky-700/80 dark:text-sky-300/80">
            Your link code
          </p>
          <p
            className="mt-2 font-mono text-4xl font-black tracking-[0.35em] text-sky-900 dark:text-sky-100"
            dir="ltr"
          >
            {formatDeviceLinkCode(linkCode.code)}
          </p>
          <p className="mt-3 text-xs text-slate-500 dark:text-zinc-400">
            Expires in {formatRemainingMs(remainingMs)}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">הקוד פג. צרו קוד חדש.</p>
      )}

      <Button
        type="button"
        variant="secondary"
        className="mt-4 w-full gap-2 sm:w-auto"
        disabled={loading}
        onClick={() => void generateCode()}
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        קוד חדש
      </Button>
    </section>
  )
}
