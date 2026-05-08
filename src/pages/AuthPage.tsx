import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AuthScreen } from '../components/auth/AuthScreen'
import { BYPASS_AUTH } from '../config/dev'
import { useAuth } from '../hooks/useAuth'
import { isProfileParentPinMissing } from '../lib/parentPin'
import { SplashScreen } from '../components/branding/SplashScreen'
import { parsePairingCodeFromLocationSearch } from '../lib/pairingCodeFromQr'
import { setSkipParentalManagementGateOnce } from '../lib/parentalGateSkipOnce'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()
  const location = useLocation()
  const pairFromUrl = parsePairingCodeFromLocationSearch(location.search, location.hash)

  /** Force-resolve session on mount (covers OAuth callback URLs Supabase may have just exchanged). */
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      if (window.location.pathname.startsWith('/auth')) {
        console.info('[AuthPage] active session detected on /auth — hard redirecting to /dashboard')
        setSkipParentalManagementGateOnce()
        window.location.replace('/dashboard')
      }
    })
  }, [])

  /** Hard fallback: if React state knows we're authenticated but we somehow still render /auth, force a real navigation. */
  useEffect(() => {
    if (loading) return
    if (!isAuthenticated) return
    if (!window.location.pathname.startsWith('/auth')) return
    const t = window.setTimeout(() => {
      if (window.location.pathname.startsWith('/auth')) {
        console.warn('[AuthPage] still on /auth after auth — forcing window.location.replace("/dashboard")')
        setSkipParentalManagementGateOnce()
        window.location.replace('/dashboard')
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [isAuthenticated, loading])

  if (pairFromUrl) {
    return <Navigate to={`/kid?code=${encodeURIComponent(pairFromUrl)}`} replace />
  }
  const nextParam = new URLSearchParams(location.search).get('next')
  const safeNext =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'

  if (BYPASS_AUTH) {
    return <Navigate to="/dashboard" replace />
  }

  if (loading) {
    return <SplashScreen />
  }

  // Session-first redirect: never keep authenticated users on the login screen.
  if (isAuthenticated && (profileLoading || !profile)) {
    setSkipParentalManagementGateOnce()
    return <Navigate to={safeNext} replace />
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
