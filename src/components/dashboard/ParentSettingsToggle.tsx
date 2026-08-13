import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Accent = 'sky' | 'violet' | 'rose' | 'amber' | 'zinc'

const ACCENT: Record<
  Accent,
  { card: string; icon: string; checked: string }
> = {
  sky: {
    card: 'border-sky-500/30 bg-sky-950/25 ring-sky-500/15',
    icon: 'text-sky-300',
    checked: 'checked:bg-sky-500',
  },
  violet: {
    card: 'border-zinc-600/70 bg-zinc-900/90 ring-zinc-700/50',
    icon: 'text-zinc-300',
    checked: 'checked:bg-sky-500',
  },
  rose: {
    card: 'border-rose-500/30 bg-rose-950/20 ring-rose-500/15',
    icon: 'text-rose-300',
    checked: 'checked:bg-rose-500',
  },
  amber: {
    card: 'border-amber-500/30 bg-amber-950/20 ring-amber-500/15',
    icon: 'text-amber-300',
    checked: 'checked:bg-amber-500',
  },
  zinc: {
    card: 'border-zinc-600/80 bg-zinc-900/90 ring-zinc-700/60',
    icon: 'text-zinc-300',
    checked: 'checked:bg-sky-500',
  },
}

type Props = {
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  icon?: ReactNode
  accent?: Accent
  className?: string
  /** When false, render row only (no card chrome) — for nested OS switch rows. */
  card?: boolean
}

/**
 * Material-style settings toggle: full-width 56dp row, 48×28 switch thumb target.
 */
export function ParentSettingsToggle({
  title,
  description,
  checked,
  disabled,
  onChange,
  icon,
  accent = 'zinc',
  className,
  card = true,
}: Props) {
  const a = ACCENT[accent]

  return (
    <div
      className={cn(
        card && 'rounded-2xl border px-4 py-3.5 ring-1',
        card && a.card,
        className
      )}
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <span className={cn('mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25', a.icon)} aria-hidden>
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4">
            <span className="text-[15px] font-semibold leading-snug text-zinc-50">{title}</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={checked}
              className={cn(
                'h-7 w-12 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-700 transition disabled:opacity-50',
                a.checked
              )}
              style={{
                backgroundImage: checked
                  ? 'radial-gradient(circle at 2.05rem center, white 0.7rem, transparent 0.72rem)'
                  : 'radial-gradient(circle at 0.55rem center, white 0.7rem, transparent 0.72rem)',
              }}
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked)}
            />
          </label>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
      </div>
    </div>
  )
}
