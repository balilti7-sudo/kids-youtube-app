import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full min-h-12 rounded-2xl border border-yt-border bg-yt-input px-4 py-3 text-[15px] text-yt-text outline-none transition placeholder:text-yt-textMuted focus-visible:border-sky-400/70 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-yt-bg',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
