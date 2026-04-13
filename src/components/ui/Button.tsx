import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 !text-white hover:bg-brand-700 active:scale-[0.98] disabled:!text-white/90',
  secondary:
    'bg-slate-200 text-slate-900 hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger: 'bg-danger-600 !text-white hover:bg-danger-500 disabled:!text-white/90',
}

export function Button({
  className,
  variant = 'primary',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50',
        variants[variant],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
