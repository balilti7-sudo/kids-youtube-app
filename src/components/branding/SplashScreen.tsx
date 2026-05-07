import { motion, useReducedMotion } from 'framer-motion'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'

/** מסך פתיחה: רקע שחור מלא, לוגו רוחב 280px, אנימציה 4 שניות. */
export function SplashScreen() {
  const reduceMotion = useReducedMotion()

  const imgClass = 'h-auto w-[280px] max-w-[min(100%,280px)] object-contain'

  if (reduceMotion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <img src={SAFETUBE_LOGO_SRC} alt="SafeTube" className={imgClass} decoding="async" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <motion.img
        src={SAFETUBE_LOGO_SRC}
        alt="SafeTube"
        className={imgClass}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 4, ease: 'easeOut' }}
        decoding="async"
      />
    </div>
  )
}
