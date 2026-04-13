import { Navigate } from 'react-router-dom'
import { AuthScreen } from '../components/auth/AuthScreen'
import { BYPASS_AUTH } from '../config/dev'
import { useAuth } from '../hooks/useAuth'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

export function AuthPage() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()

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
    return <Navigate to="/dashboard" replace />
  }

  if (isAuthenticated && profile && !profile.onboarding_done) {
    return <Navigate to="/onboarding" replace />
  }

  return <AuthScreen />
}
