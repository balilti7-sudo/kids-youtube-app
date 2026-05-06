import { SafeTubeLogo } from './SafeTubeLogo'

/** Full-viewport splash while auth/session is loading (matches Auth hero: black canvas, same logo treatment). */
export function SplashScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-black px-6">
      <SafeTubeLogo size="lg" entranceAnimation withLivingPulse />
    </div>
  )
}
