import { cn } from '../../lib/utils'

type Step = {
  label: string
  status: 'done' | 'current' | 'upcoming'
}

/** Compact 1–2–3 progress for D-Pad / small screens. */
export function OnboardingStepper({
  steps,
  className,
}: {
  steps: Step[]
  className?: string
}) {
  return (
    <ol
      className={cn('flex w-full items-stretch justify-between gap-1', className)}
      aria-label="התקדמות הרשמה"
    >
      {steps.map((step, index) => {
        const n = index + 1
        const isCurrent = step.status === 'current'
        const isDone = step.status === 'done'
        return (
          <li
            key={step.label}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-center',
              isCurrent && 'bg-sky-500/15 ring-2 ring-sky-400/70'
            )}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                isDone && 'bg-brand-600 text-white',
                isCurrent && 'bg-sky-500 text-white',
                step.status === 'upcoming' && 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              )}
            >
              {isDone ? '✓' : n}
            </span>
            <span
              className={cn(
                'line-clamp-2 text-[10px] font-semibold leading-tight xs:text-xs',
                isCurrent ? 'text-sky-800 dark:text-sky-200' : 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
