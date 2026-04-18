import { Navigate, useLocation } from 'react-router-dom'
import { AuthScreen } from '../components/auth/AuthScreen'
import { BYPASS_AUTH } from '../config/dev'
import { useAuth } from '../hooks/useAuth'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { parsePairingCodeFromLocationSearch } from '../lib/pairingCodeFromQr'

export function AuthPage() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()
  const location = useLocation()
  const pairFromUrl = parsePairingCodeFromLocationSearch(location.search)
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
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingSpinner className="h-10 w-10" />
      </div>
    )
  }

  if (isAuthenticated && profile?.onboarding_done) {
    return <Navigate to={safeNext} replace />
  }

  if (isAuthenticated && profile && !profile.onboarding_done) {
    return <Navigate to="/onboarding" replace />
  }

  return <AuthScreen />
}
