import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'

type Props = {
  /** Default `lg` = 320px wide; height follows aspect ratio. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** 2.5s easeOut entrance (scale + opacity). */
  entranceAnimation?: boolean
  /**
   * After the entrance, a subtle 10s opacity loop (1 ↔ 0.7). Use on Auth + splash only.
   * The wordmark is part of `logo.png`; the effect applies to the full image so the “SafeTube” area breathes visually.
   */
  withLivingPulse?: boolean
}

const sizeWidths = {
  sm: 'w-[200px] max-w-[min(100%,200px)]',
  md: 'w-[260px] max-w-[min(100%,260px)]',
  lg: 'w-[320px] max-w-[min(100%,320px)]',
} as const

/** Official `public/logo.png`; containers stay transparent (no fill behind the asset). */
export function SafeTubeLogo({
  size = 'lg',
  className,
  entranceAnimation = false,
  withLivingPulse = false,
}: Props) {
  const prefersReduced = useReducedMotion()
  const [phase, setPhase] = useState<'enter' | 'pulse'>('enter')

  const widthClass = sizeWidths[size]

  const imgClassName = cn('block h-auto object-contain bg-transparent', widthClass)

  const runPulse = withLivingPulse && entranceAnimation && !prefersReduced

  useEffect(() => {
    if (!runPulse) return
    const id = window.setTimeout(() => setPhase('pulse'), 2500)
    return () => window.clearTimeout(id)
  }, [runPulse])

  const staticLogo = (
    <div className={cn('mx-auto w-fit bg-transparent', className)}>
      <img src="/logo.png" alt="SafeTube" className={imgClassName} decoding="async" />
    </div>
  )

  if (!entranceAnimation || prefersReduced) {
    return staticLogo
  }

  const showPulseLoop = runPulse && phase === 'pulse'

  return (
    <div className={cn('mx-auto w-fit bg-transparent', className)}>
      <motion.img
        src="/logo.png"
        alt="SafeTube"
        className={imgClassName}
        decoding="async"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={
          showPulseLoop
            ? { scale: 1, opacity: [1, 0.7, 1] }
            : { scale: 1, opacity: 1 }
        }
        transition={
          showPulseLoop
            ? { duration: 10, repeat: Infinity, ease: 'easeInOut', repeatType: 'loop' }
            : { duration: 2.5, ease: 'easeOut' }
        }
      />
    </div>
  )
}
