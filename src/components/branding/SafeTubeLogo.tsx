import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/utils'

type Props = {
  /** Visual height cap; width follows intrinsic aspect ratio. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /**
   * Spring entrance (Auth + Onboarding). Respected when `prefers-reduced-motion` is off.
   */
  entranceAnimation?: boolean
}

const sizeClass = {
  sm: 'h-11 w-auto max-w-[min(100%,260px)]',
  md: 'h-12 w-auto max-w-[min(100%,280px)]',
  lg: 'h-14 w-auto max-w-[min(100%,280px)]',
} as const

const springEntrance = {
  type: 'spring' as const,
  stiffness: 200,
  damping: 15,
}

/** Official `public/logo.png` wordmark only (no SVG). Renders with alpha. */
export function SafeTubeLogo({ size = 'lg', className, entranceAnimation = false }: Props) {
  const prefersReduced = useReducedMotion()
  const img = (
    <img
      src="/logo.png"
      alt="SafeTube"
      className={cn('block object-contain bg-transparent', sizeClass[size])}
      decoding="async"
    />
  )

  const animate = entranceAnimation && !prefersReduced

  if (!animate) {
    return <div className={cn('mx-auto w-fit', className)}>{img}</div>
  }

  return (
    <motion.div
      className={cn('mx-auto w-fit', className)}
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        ...springEntrance,
        // Target ~0.8s settle time alongside spring physics (per product spec)
        duration: 0.8,
      }}
    >
      {img}
    </motion.div>
  )
}
