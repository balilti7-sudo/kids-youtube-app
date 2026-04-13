import { Navigate, useLocation } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { useAuth } from '../../hooks/useAuth'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, profile } = useAuth()
  const location = useLocation()

  if (BYPASS_AUTH) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingSpinner className="h-10 w-10" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" state={{ from: location }} replace />
  }

  if (profile?.onboarding_done && location.pathname === '/onboarding') {
    return <Navigate to="/dashboard" replace />
  }

  if (profile && !profile.onboarding_done && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}
