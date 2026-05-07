import { motion, useReducedMotion } from 'framer-motion'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'

/** מסך פתיחה: רקע שחור מלא, לוגו PNG שקוף, ללא blend / overlay / filters. */
export function SplashScreen() {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <img
          src={SAFETUBE_LOGO_SRC}
          alt="SafeTube"
          className="h-auto w-[350px] max-w-[min(100%,350px)] object-contain"
          decoding="async"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <motion.img
        src={SAFETUBE_LOGO_SRC}
        alt="SafeTube"
        className="h-auto w-[350px] max-w-[min(100%,350px)] object-contain"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 4, ease: 'easeOut' }}
        decoding="async"
      />
    </div>
  )
}
