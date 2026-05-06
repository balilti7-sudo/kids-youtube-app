import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
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

  /** Kills faint matte “box” on mobile when PNG sits on pure black; Tailwind + inline for Safari. */
  const imgClassName = cn(
    'block h-auto max-w-full border-0 object-contain bg-transparent shadow-none outline-none ring-0',
    '[mix-blend-mode:plus-lighter]',
    'transform-gpu backface-hidden will-change-[opacity,transform]',
    widthClass
  )

  const imgBlendStyle = useMemo((): CSSProperties => {
    const s: CSSProperties & Record<string, string> = {
      mixBlendMode: 'plus-lighter',
      WebkitMixBlendMode: 'plus-lighter',
    }
    return s
  }, [])

  const logoWrapClass = 'mx-auto w-fit border-0 bg-transparent p-0 shadow-none ring-0 outline-none'

  const runPulse = withLivingPulse && entranceAnimation && !prefersReduced

  useEffect(() => {
    if (!runPulse) return
    const ms = ENTRANCE_DURATION_S * 1000
    const id = window.setTimeout(() => setPhase('pulse'), ms)
    return () => window.clearTimeout(id)
  }, [runPulse])

  const staticLogo = (
    <div className={cn(logoWrapClass, className)}>
      <img src="/logo.png" alt="SafeTube" className={imgClassName} style={imgBlendStyle} decoding="async" />
    </div>
  )

  if (!entranceAnimation || prefersReduced) {
    return staticLogo
  }

  const showPulseLoop = runPulse && phase === 'pulse'

  return (
    <div className={cn(logoWrapClass, className)}>
      <motion.img
        src="/logo.png"
        alt="SafeTube"
        className={imgClassName}
        style={imgBlendStyle}
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
            : {
                duration: ENTRANCE_DURATION_S,
                ease: [0.22, 0.99, 0.36, 1],
              }
        }
      />
    </div>
  )
}
