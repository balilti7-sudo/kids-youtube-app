import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Badge({
  children,
  variant = 'neutral',
  className,
}: {
  children: ReactNode
  variant?: 'neutral' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const styles = {
    neutral: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200',
    success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
    danger: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', styles[variant], className)}>
      {children}
    </span>
  )
}
