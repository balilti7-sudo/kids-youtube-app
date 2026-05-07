import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '../../lib/utils'

/** נתיב עם query לשבירת cache במובייל (אפשר גם `public/logo-final.png` אם תעביר קובץ). */
export const SAFETUBE_LOGO_SRC = '/logo.png?v=2'

type Props = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  entranceAnimation?: boolean
}

const sizeWidths = {
  sm: 'w-[200px] max-w-[min(100%,200px)]',
  md: 'w-[280px] max-w-[min(100%,280px)]',
  lg: 'w-[350px] max-w-[min(100%,350px)]',
} as const

const ENTRANCE_DURATION_S = 4

/**
 * לוגו PNG שקוף בלבד — בלי mix-blend, בלי filter, בלי רקע על ה-img.
 * להצגה על רקע שחור: עטוף את הרכיב ב-`bg-black` (כמו ב-AuthScreen).
 */
export function SafeTubeLogo({ size = 'lg', className, entranceAnimation = false }: Props) {
  const prefersReduced = useReducedMotion()

  const imgClass = cn(
    'mx-auto block h-auto max-w-full border-0 object-contain shadow-none outline-none ring-0',
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
