import { Navigate, useLocation } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { useAuth } from '../../hooks/useAuth'
import { parsePairingCodeFromLocationSearch } from '../../lib/pairingCodeFromQr'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, profile } = useAuth()
  const location = useLocation()
  const pairFromUrl = parsePairingCodeFromLocationSearch(location.search, location.hash)

  if (BYPASS_AUTH) {
    return <>{children}</>
  }

  /** צימוד לילד לא דורש סשן הורה — לא לחסום מאחורי ספינר auth */
  if (pairFromUrl) {
    return <Navigate to={`/kid?code=${encodeURIComponent(pairFromUrl)}`} replace />
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
