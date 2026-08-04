import { CheckCircle2, Circle, Link2, Smartphone, Tv } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  if (dismissed) return null

  const steps: Step[] = [
    {
      id: 'profile',
      title: t('setupGuide.stepProfileTitle'),
      detail: t('setupGuide.stepProfileDetail'),
      done: hasProfiles,
      ctaLabel: hasProfiles ? undefined : t('setupGuide.stepProfileCta'),
      onCta: hasProfiles ? undefined : onAddProfile,
      highlight: !hasProfiles,
    },
    {
      id: 'pair',
      title: t('setupGuide.stepPairTitle'),
      detail: t('setupGuide.stepPairDetail'),
      done: hasProfiles && !hasPairingCodeReady,
      ctaLabel: hasProfiles && hasPairingCodeReady ? t('setupGuide.stepPairCta') : undefined,
      onCta: hasProfiles && hasPairingCodeReady ? onShowPairing : undefined,
      highlight: hasProfiles && hasPairingCodeReady,
    },
    {
      id: 'channels',
      title: t('setupGuide.stepChannelsTitle'),
      detail: t('setupGuide.stepChannelsDetail'),
      done: hasChannelsManaged,
      ctaLabel: hasProfiles && !hasChannelsManaged ? t('setupGuide.stepChannelsCta') : undefined,
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
          {t('setupGuide.completed')}
        </span>
        <Button type="button" variant="secondary" className="!h-8 !px-2.5 !text-xs" onClick={onDismiss}>
          {t('setupGuide.dismiss')}
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
            {t('setupGuide.title')}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">{t('setupGuide.subtitle')}</p>
        </div>
        {onDismiss && hasProfiles ? (
          <button
            type="button"
            className="text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
            onClick={onDismiss}
          >
            {t('setupGuide.hideGuide')}
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
