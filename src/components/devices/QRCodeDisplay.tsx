import { QRCodeSVG } from 'qrcode.react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

function kidPairingUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/kid?code=${encodeURIComponent(code)}`
}

type Props = {
  code: string
  deviceName?: string | null
  className?: string
  compact?: boolean
}

/** Shows the 6-digit pairing code + scannable QR for the kid device. */
export function QRCodeDisplay({ code, deviceName, className, compact }: Props) {
  const trimmed = code.trim()
  const url = kidPairingUrl(trimmed)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(trimmed)
      toast.success('הקוד הועתק')
    } catch {
      toast.error('לא ניתן להעתיק')
    }
  }

  return (
    <div
      className={cn(
        'rounded-2xl border-2 border-dashed border-brand-400/50 bg-brand-50/90 p-4 text-center dark:border-brand-700/60 dark:bg-brand-950/40',
        compact ? 'p-3' : 'p-5 sm:p-6',
        className
      )}
    >
      {deviceName ? (
        <p className="mb-1 text-xs font-semibold text-brand-800 dark:text-brand-200">
          חיבור מכשיר הילד — {deviceName}
        </p>
      ) : null}
      <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">קוד צימוד (6 ספרות)</p>
      <p
        className={cn(
          'mt-2 font-mono font-bold tracking-[0.28em] text-slate-900 dark:text-zinc-50',
          compact ? 'text-3xl' : 'text-4xl'
        )}
        dir="ltr"
      >
        {trimmed}
      </p>
      <div className="mx-auto mt-3 flex justify-center rounded-xl bg-white p-3 shadow-sm dark:bg-zinc-900">
        <QRCodeSVG value={url} size={compact ? 128 : 160} level="M" includeMargin={false} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
        במכשיר הילד: פתחו SafeTube ← הזינו את הקוד, או סרקו את ה־QR.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 gap-1.5 !px-3 !py-2 text-xs"
        onClick={() => void copyCode()}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        העתקת קוד
      </Button>
    </div>
  )
}
