import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full min-h-12 rounded-2xl border border-yt-border bg-yt-input px-4 py-3 text-[15px] text-yt-text outline-none transition placeholder:text-yt-textMuted focus:border-yt-textMuted/50 focus:ring-2 focus:ring-yt-textMuted/25',
          className
        )}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
