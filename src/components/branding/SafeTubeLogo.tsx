import { cn } from '../../lib/utils'

type Props = {
  /** Visual height cap; width follows intrinsic aspect ratio. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass = {
  sm: 'h-11 w-auto max-w-[min(100%,260px)]',
  md: 'h-12 w-auto max-w-[min(100%,280px)]',
  lg: 'h-14 w-auto max-w-[min(100%,320px)]',
} as const

/** Official `public/logo.png` wordmark only (no SVG). Renders with alpha; use on surfaces without forcing a white tile behind the asset. */
export function SafeTubeLogo({ size = 'lg', className }: Props) {
  return (
    <img
      src="/logo.png"
      alt="SafeTube"
      className={cn(
        'mx-auto block object-contain bg-transparent',
        sizeClass[size],
        className
      )}
      decoding="async"
    />
  )
}
