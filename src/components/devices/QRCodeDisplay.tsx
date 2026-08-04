import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type Props = {
  code: string
  deviceName?: string | null
  className?: string
  compact?: boolean
}

/** Shows the 6-digit pairing code for the kid device (text only — no QR). */
export function PairingCodeDisplay({ code, deviceName, className, compact }: Props) {
  const { t } = useTranslation()
  const trimmed = code.trim()

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(trimmed)
      toast.success(t('pairing.codeCopied'))
    } catch {
      toast.error(t('pairing.copyFailed'))
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
          {t('pairing.connectDeviceNamed', { name: deviceName })}
        </p>
      ) : null}
      <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">{t('pairing.codeLabel')}</p>
      <p
        className={cn(
          'mt-2 font-mono font-bold tracking-[0.28em] text-slate-900 dark:text-zinc-50',
          compact ? 'text-3xl' : 'text-4xl'
        )}
        dir="ltr"
      >
        {trimmed}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
        {t('pairing.enterOnKidDevice')}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 gap-1.5 !px-3 !py-2 text-xs"
        onClick={() => void copyCode()}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden />
        {t('pairing.copyCode')}
      </Button>
    </div>
  )
}

/** @deprecated Use PairingCodeDisplay */
export const QRCodeDisplay = PairingCodeDisplay
