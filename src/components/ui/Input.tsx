import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-full border border-yt-border bg-yt-input px-4 py-2.5 text-sm text-yt-text outline-none transition placeholder:text-yt-textMuted focus:border-yt-textMuted/50 focus:ring-1 focus:ring-yt-textMuted/30',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
