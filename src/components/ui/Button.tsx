import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-yt-bg'

const variants: Record<Variant, string> = {
  primary: cn('yt-pill-btn-primary disabled:opacity-50', FOCUS),
  secondary: cn('yt-pill-btn-secondary disabled:opacity-50', FOCUS),
  ghost: cn(
    'inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-medium text-yt-textMuted transition hover:bg-yt-surface hover:text-yt-text disabled:opacity-50',
    FOCUS
  ),
  danger: cn(
    'inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full bg-yt-red px-5 py-3 text-[15px] font-semibold text-white transition hover:bg-red-600 disabled:opacity-50',
    FOCUS
  ),
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
      className={cn(variants[variant], className)}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
