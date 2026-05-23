import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'yt-pill-btn-primary disabled:opacity-50',
  secondary: 'yt-pill-btn-secondary disabled:opacity-50',
  ghost:
    'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-yt-textMuted transition hover:bg-yt-surface hover:text-yt-text disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-2 rounded-full bg-yt-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50',
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
