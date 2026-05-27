import { Navigate, useLocation } from 'react-router-dom'
import { BYPASS_AUTH } from '../../config/dev'
import { useAuth } from '../../hooks/useAuth'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { isLocalParentSessionValid } from '../../lib/localParentAdmin'
import { isProfileParentPinMissing } from '../../lib/parentPin'
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
    const kidToken = getSavedChildAccessToken()
    if (kidToken && location.pathname === '/channels') {
      return <>{children}</>
    }
    if (isLocalParentSessionValid() && kidToken) {
      return <>{children}</>
    }
    return <Navigate to="/auth" state={{ from: location }} replace />
  }

  if (profile?.onboarding_done && location.pathname === '/onboarding') {
    if (isProfileParentPinMissing(profile)) {
      return <Navigate to="/set-parent-pin" replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  if (profile && !profile.onboarding_done && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }

  if (profile?.onboarding_done && isProfileParentPinMissing(profile) && location.pathname !== '/set-parent-pin') {
    return <Navigate to="/set-parent-pin" replace />
  }

  if (profile?.onboarding_done && !isProfileParentPinMissing(profile) && location.pathname === '/set-parent-pin') {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
