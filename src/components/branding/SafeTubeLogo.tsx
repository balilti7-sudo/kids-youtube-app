import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'

type Props = {
  /** Default `lg` = 350px wide; height follows aspect ratio. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Slow fade + scale entrance (Auth, Onboarding, Splash). */
  entranceAnimation?: boolean
  /**
   * After the entrance, a subtle 10s opacity loop (Auth + splash only).
   * Timing aligns with the 4s entrance when this is enabled.
   */
  withLivingPulse?: boolean
}

const sizeWidths = {
  sm: 'w-[200px] max-w-[min(100%,200px)]',
  md: 'w-[280px] max-w-[min(100%,280px)]',
  lg: 'w-[350px] max-w-[min(100%,350px)]',
} as const

const ENTRANCE_DURATION_S = 4

/** Official `public/logo.png` only — no border, no container background. */
export function SafeTubeLogo({
  size = 'lg',
  className,
  entranceAnimation = false,
  withLivingPulse = false,
}: Props) {
  const prefersReduced = useReducedMotion()
  const [phase, setPhase] = useState<'enter' | 'pulse'>('enter')

  const widthClass = sizeWidths[size]

  /** Kills gray/white matte fringes on mobile; `style` helps WebKit/Safari. */
  const imgClassName = cn(
    'block h-auto max-w-full border-0 object-contain bg-transparent shadow-none outline-none ring-0',
    '[mix-blend-mode:plus-lighter]',
    'transform-gpu backface-hidden will-change-[opacity,transform]',
    widthClass
  )

  const imgStyle = { mixBlendMode: 'plus-lighter' as const }

  const runPulse = withLivingPulse && entranceAnimation && !prefersReduced

  useEffect(() => {
    if (!runPulse) return
    const ms = ENTRANCE_DURATION_S * 1000
    const id = window.setTimeout(() => setPhase('pulse'), ms)
    return () => window.clearTimeout(id)
  }, [runPulse])

  const staticLogo = (
    <div className={cn('mx-auto w-fit border-0 bg-transparent p-0 shadow-none', className)}>
      <img src="/logo.png" alt="SafeTube" className={imgClassName} style={imgStyle} decoding="async" />
    </div>
  )

  if (!entranceAnimation || prefersReduced) {
    return staticLogo
  }

  const showPulseLoop = runPulse && phase === 'pulse'

  return (
    <div className={cn('mx-auto w-fit border-0 bg-transparent p-0 shadow-none', className)}>
      <motion.img
        src="/logo.png"
        alt="SafeTube"
        className={imgClassName}
        style={imgStyle}
        decoding="async"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={
          showPulseLoop
            ? { scale: 1, opacity: [1, 0.7, 1] }
            : { scale: 1, opacity: 1 }
        }
        transition={
          showPulseLoop
            ? { duration: 10, repeat: Infinity, ease: 'easeInOut', repeatType: 'loop' }
            : { duration: ENTRANCE_DURATION_S, ease: 'easeOut' }
        }
      />
    </div>
  )
}
