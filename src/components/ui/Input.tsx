import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-brand-500 focus:border-brand-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
