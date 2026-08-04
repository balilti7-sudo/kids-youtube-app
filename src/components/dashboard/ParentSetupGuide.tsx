import { CheckCircle2, Circle, Link2, Smartphone, Tv } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

export type SetupGuideStepId = 'profile' | 'pair' | 'channels'

type Step = {
  id: SetupGuideStepId
  title: string
  detail: string
  done: boolean
  ctaLabel?: string
  onCta?: () => void
  highlight?: boolean
}

type Props = {
  hasProfiles: boolean
  hasPairingCodeReady: boolean
  hasChannelsManaged: boolean
  onAddProfile: () => void
  onShowPairing: () => void
  onManageChannels: () => void
  className?: string
  dismissed?: boolean
  onDismiss?: () => void
}

/**
 * First-visit checklist so parents know: create profile → pair kid → add channels.
 */
export function ParentSetupGuide({
  hasProfiles,
  hasPairingCodeReady,
  hasChannelsManaged,
  onAddProfile,
  onShowPairing,
  onManageChannels,
  className,
  dismissed,
  onDismiss,
}: Props) {
  if (dismissed) return null

  const steps: Step[] = [
    {
      id: 'profile',
      title: 'צרו פרופיל לילד',
      detail: 'כל פרופיל מקבל קוד צימוד להפעלת מסך הילד.',
      done: hasProfiles,
      ctaLabel: hasProfiles ? undefined : 'הוספת פרופיל',
      onCta: hasProfiles ? undefined : onAddProfile,
      highlight: !hasProfiles,
    },
    {
      id: 'pair',
      title: 'חברו את מכשיר הילד',
      detail: 'הזינו את קוד ה־6 ספרות (או סרקו QR) במסך הילד.',
      done: hasProfiles && !hasPairingCodeReady,
      ctaLabel: hasProfiles && hasPairingCodeReady ? 'הצגת קוד צימוד' : undefined,
      onCta: hasProfiles && hasPairingCodeReady ? onShowPairing : undefined,
      highlight: hasProfiles && hasPairingCodeReady,
    },
    {
      id: 'channels',
      title: 'הוסיפו ערוצים מאושרים',
      detail: 'רק ערוצים שתאשרו יופיעו לילד — זה השלב לצפייה.',
      done: hasChannelsManaged,
      ctaLabel: hasProfiles && !hasChannelsManaged ? 'ניהול ערוצים' : undefined,
      onCta: hasProfiles && !hasChannelsManaged ? onManageChannels : undefined,
      highlight: hasProfiles && !hasPairingCodeReady && !hasChannelsManaged,
    },
  ]

  const allDone = steps.every((s) => s.done)
  if (allDone && onDismiss) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-2.5 text-sm text-emerald-100',
          className
        )}
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ההגדרה הראשונית הושלמה — אפשר לצפות בתוכן בטוח.
        </span>
        <Button type="button" variant="secondary" className="!h-8 !px-2.5 !text-xs" onClick={onDismiss}>
          הסתר
        </Button>
      </div>
    )
  }

  const icons = {
    profile: Smartphone,
    pair: Link2,
    channels: Tv,
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-sky-500/30 bg-sky-950/25 p-3 shadow-inner ring-1 ring-sky-500/15 sm:p-4',
        className
      )}
      aria-labelledby="setup-guide-title"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="setup-guide-title" className="text-base font-bold text-zinc-50">
            התחלה מהירה
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">שלושה צעדים והילד כבר צופה בערוצים שאישרתם.</p>
        </div>
        {onDismiss && hasProfiles ? (
          <button
            type="button"
            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
            onClick={onDismiss}
          >
            הסתר מדריך
          </button>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const Icon = icons[step.id]
          return (
            <li
              key={step.id}
              className={cn(
                'flex gap-3 rounded-xl border px-3 py-2.5 transition',
                step.highlight
                  ? 'border-sky-400/50 bg-sky-500/15 ring-1 ring-sky-400/30'
                  : step.done
                    ? 'border-zinc-700/50 bg-zinc-950/40 opacity-80'
                    : 'border-zinc-700/60 bg-zinc-950/50'
              )}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
                {step.done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                ) : (
                  <span className="relative">
                    <Circle className="h-6 w-6 text-zinc-500" />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-zinc-300">
                      {index + 1}
                    </span>
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{step.detail}</p>
                {step.ctaLabel && step.onCta ? (
                  <Button
                    type="button"
                    className="mt-2 !h-9 w-full sm:w-auto !px-4 !text-sm font-bold"
                    onClick={step.onCta}
                  >
                    {step.ctaLabel}
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
