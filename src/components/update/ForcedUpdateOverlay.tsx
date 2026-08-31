import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { AppLauncher } from '@capacitor/app-launcher'
import { Download, ShieldAlert } from 'lucide-react'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import type { AppUpdateGateState } from '../../lib/appUpdatePolicy'

type SoftOrHard = Extract<AppUpdateGateState, { status: 'soft' | 'hard' }>

type Props = {
  gate: SoftOrHard
  onSkip?: () => void
}

async function openUpdateUrl(url: string) {
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        await Browser.open({ url })
        return
      } catch {
        await AppLauncher.openUrl({ url })
        return
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (err) {
    console.warn('[ForcedUpdateOverlay] open url failed', err)
  }
}

/**
 * Lightweight forced-update overlay (soft dismissible / hard blocking).
 * Hard lock is mounted alone (no app shell underneath) — full-app WhatsApp-style gate.
 */
export function ForcedUpdateOverlay({ gate, onSkip }: Props) {
  const hard = gate.status === 'hard'
  const { policy, installedVersion, daysRemainingInGrace } = gate

  return createPortal(
    <div
      className={cn(
        'safe-area-pad fixed inset-0 z-[240] flex items-end justify-center bg-zinc-950/75 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-6',
        hard && 'bg-zinc-950/90'
      )}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="safetube-update-title"
      aria-describedby="safetube-update-body"
    >
      <div
        className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 text-zinc-50 shadow-2xl shadow-black/50"
        dir="rtl"
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
            <ShieldAlert className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="safetube-update-title" className="text-base font-bold leading-snug">
              {policy.titleHe}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              מותקן: {installedVersion} · נדרש: {policy.latestVersion}
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p id="safetube-update-body" className="text-sm leading-relaxed text-zinc-300">
            {policy.messageHe}
          </p>
          {hard ? (
            <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/25">
              תקופת החסד הסתיימה. יש לעדכן כדי להמשיך לצפות.
            </p>
          ) : (
            <p className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-100/90 ring-1 ring-sky-400/20">
              אפשר לדלג עוד כ־{daysRemainingInGrace}{' '}
              {daysRemainingInGrace === 1 ? 'יום' : 'ימים'}. אחר כך העדכון יהפוך לחובה.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 px-5 pb-5">
          <Button
            type="button"
            className="w-full gap-2"
            onClick={() => void openUpdateUrl(policy.storeUrl)}
          >
            <Download className="h-4 w-4" aria-hidden />
            עדכון עכשיו
          </Button>
          {!hard && onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
            >
              אחר כך
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
