import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'

/** How long the branded boot splash stays on screen before the app appears. */
export const BOOT_SPLASH_MS = 2000
const LOGO_FADE_S = 0.45

/** מסך פתיחה: רקע שחור, לוגו 280px. האנימציה קצרה; BootSplash מחזיק 2 שניות. */
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
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: LOGO_FADE_S, ease: 'easeOut' }}
        decoding="async"
      />
    </div>
  )
}

/**
 * Shows the logo splash for 2 seconds on launch, while the app loads underneath.
 * After 2 seconds the overlay is removed so the app appears immediately.
 */
export function BootSplash({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(false), BOOT_SPLASH_MS)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <>
      {children}
      {visible ? (
        <div className="fixed inset-0 z-[9999]" aria-busy="true" aria-label="טוען את SafeTube">
          <SplashScreen />
        </div>
      ) : null}
    </>
  )
}
