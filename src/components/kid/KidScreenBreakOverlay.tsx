import { MoonStar } from 'lucide-react'
import type { KidScreenBreakReason } from '../../lib/kidScreenControl'

type KidScreenBreakOverlayProps = {
  reason: KidScreenBreakReason
}

const REASON_HINT: Record<KidScreenBreakReason, string> = {
  remote_pause: 'ההורה הקפיא את המסך מרחוק.',
  time_limit: 'הגעתם לזמן הצפייה היומי.',
  bedtime: 'הגיע זמן השינה.',
}

export function KidScreenBreakOverlay({ reason }: KidScreenBreakOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-b from-indigo-950/95 via-slate-950/98 to-black p-6"
      role="dialog"
      aria-modal="true"
      aria-label="זמן להפסקה"
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-indigo-500/15 ring-2 ring-indigo-400/30">
          <MoonStar className="h-14 w-14 text-indigo-200" strokeWidth={1.75} aria-hidden />
        </div>
        <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
          זמן להפסקה! ניפגש מאוחר יותר 🛌
        </h2>
        <p className="mt-4 text-base leading-relaxed text-indigo-100/90">{REASON_HINT[reason]}</p>
        <p className="mt-2 text-sm text-indigo-200/70">בקשו מההורה כשיהיה זמן לחזור.</p>
      </div>
    </div>
  )
}
