import type { CSSProperties, ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { rgbToCss, useDominantPosterColor } from '../../hooks/useDominantPosterColor'

type Props = {
  posterUrl?: string | null
  /** Used when poster is missing or CORS-blocked — still yields a soft glow. */
  colorSeed?: string | null
  enabled?: boolean
  className?: string
  children: ReactNode
}

/**
 * Soft ambient glow from the poster palette — CSS-only blur, no per-frame video sampling.
 */
export function PlayerAmbientFrame({
  posterUrl,
  colorSeed,
  enabled = true,
  className,
  children,
}: Props) {
  const sampleKey = enabled ? posterUrl || colorSeed || null : null
  const rgb = useDominantPosterColor(sampleKey)
  const glow = enabled ? rgbToCss(rgb, 0.55) : null
  const glowSoft = enabled ? rgbToCss(rgb, 0.28) : null

  const style: CSSProperties | undefined =
    glow && glowSoft
      ? {
          boxShadow: `0 0 28px 8px ${glow}, 0 0 64px 18px ${glowSoft}`,
        }
      : undefined

  return (
    <div className={cn('relative isolate', className)} style={style}>
      {glow ? (
        <div
          className="pointer-events-none absolute -inset-3 -z-10 rounded-[1.25rem] opacity-80 blur-2xl"
          style={{ background: glowSoft ?? glow }}
          aria-hidden
        />
      ) : null}
      {children}
    </div>
  )
}
