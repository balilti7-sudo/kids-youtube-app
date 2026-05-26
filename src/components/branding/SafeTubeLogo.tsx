import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/utils'

/** Cache-bust when replacing `public/logo.png`. */
export const SAFETUBE_LOGO_SRC = '/logo.png?v=5'

type Props = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  entranceAnimation?: boolean
}

/** `lg` = 280px רוחב (יחס ~850×250); בלי mix-blend — רק `<img>`. */
const sizeWidths = {
  sm: 'w-[200px] max-w-[min(100%,200px)]',
  md: 'w-[240px] max-w-[min(100%,240px)]',
  lg: 'w-[280px] max-w-[min(100%,280px)]',
} as const

const ENTRANCE_DURATION_S = 4

/**
 * לוגו מ-`public/logo.png` — רינדור ישיר ושקוף, ללא mix-blend / filters / רקע על ה-img.
 */
export function SafeTubeLogo({ size = 'lg', className, entranceAnimation = false }: Props) {
  const prefersReduced = useReducedMotion()

  const imgClass = cn(
    'mx-auto block h-auto max-w-full border-0 bg-transparent object-contain shadow-none outline-none ring-0',
    sizeWidths[size]
  )

  const wrap = cn('mx-auto w-fit', className)

  if (!entranceAnimation || prefersReduced) {
    return (
      <div className={wrap}>
        <img src={SAFETUBE_LOGO_SRC} alt="SafeTube" className={imgClass} decoding="async" />
      </div>
    )
  }

  return (
    <div className={wrap}>
      <motion.img
        src={SAFETUBE_LOGO_SRC}
        alt="SafeTube"
        className={imgClass}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: ENTRANCE_DURATION_S, ease: 'easeOut' }}
        decoding="async"
      />
    </div>
  )
}
