import { Navigate, useLocation } from 'react-router-dom'
import { AuthScreen } from '../components/auth/AuthScreen'
import { BYPASS_AUTH } from '../config/dev'
import { useAuth } from '../hooks/useAuth'
import { isProfileParentPinMissing } from '../lib/parentPin'
import { SplashScreen } from '../components/branding/SplashScreen'
import { parsePairingCodeFromLocationSearch } from '../lib/pairingCodeFromQr'
import { setSkipParentalManagementGateOnce } from '../lib/parentalGateSkipOnce'

export function AuthPage() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()
  const location = useLocation()
  const pairFromUrl = parsePairingCodeFromLocationSearch(location.search, location.hash)

  if (pairFromUrl) {
    return <Navigate to={`/kid?code=${encodeURIComponent(pairFromUrl)}`} replace />
  }
  const nextParam = new URLSearchParams(location.search).get('next')
  const safeNext =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'

  if (BYPASS_AUTH) {
    return <Navigate to="/dashboard" replace />
  }

  if (loading || (isAuthenticated && profileLoading)) {
    return <SplashScreen />
  }

  if (isAuthenticated && profile?.onboarding_done) {
    if (isProfileParentPinMissing(profile)) {
      setSkipParentalManagementGateOnce()
      return <Navigate to="/set-parent-pin" replace />
    }
    setSkipParentalManagementGateOnce()
    return <Navigate to={safeNext} replace />
  }

  if (isAuthenticated && profile && !profile.onboarding_done) {
    setSkipParentalManagementGateOnce()
    return <Navigate to="/onboarding" replace />
  }

  return <AuthScreen />
}
