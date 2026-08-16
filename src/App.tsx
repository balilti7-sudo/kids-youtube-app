import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { ThemeAwareToaster } from './components/theme/ThemeAwareToaster'
import { SplashScreen } from './components/branding/SplashScreen'
import { TesterAccessGate } from './components/auth/TesterAccessGate'
import { AuthPage } from './pages/AuthPage'
import AuthCallback from './pages/AuthCallback'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { AddProfilePage } from './pages/AddProfilePage'
import { ManageProfilePage } from './pages/ManageProfilePage'
import { ChannelsPage } from './pages/ChannelsPage'
import { PlaylistsPage } from './pages/PlaylistsPage'
import { HiddenVideosPage } from './pages/HiddenVideosPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { KidModePage } from './pages/KidModePage'
import { SetParentPinPage } from './pages/SetParentPinPage'
import { DevUiGalleryPage } from './pages/DevUiGalleryPage'
import { useAuth } from './hooks/useAuth'
import { BYPASS_AUTH } from './config/dev'
import { WhatsAppFloatingButton } from './components/support/WhatsAppFloatingButton'
import { preWarmMediaBridge } from './lib/streamApi'
import { JuicyUiProvider } from './contexts/JuicyUiContext'

function KidModeRoute() {
  return (
    <JuicyUiProvider enabled>
      <KidModePage />
    </JuicyUiProvider>
  )
}

function SmartEntryRoute() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()

  const hasKidToken =
    typeof window !== 'undefined' && Boolean(window.localStorage.getItem('safetube_kid_access_token'))

  if (BYPASS_AUTH) return <Navigate to="/dashboard" replace />

  if (loading) {
    return <SplashScreen />
  }

  if (isAuthenticated && profileLoading) {
    return <SplashScreen />
  }

  // Kid mode is the default only when there is no parent session (this tablet is the viewing device).
  // A signed-in parent can still open the dashboard; the kid token alone does not lock them out.
  if (!isAuthenticated && hasKidToken) return <Navigate to="/kid" replace />
  if (!isAuthenticated) return <Navigate to="/auth" replace />
  if (profile && !profile.onboarding_done) return <Navigate to="/onboarding" replace />
  return <Navigate to="/dashboard" replace />
}

function CatchAllRedirect() {
  return <Navigate to="/" replace />
}

function AppChrome() {
  const location = useLocation()
  const hideSupportFab = location.pathname === '/kid'

  return (
    <>
      {hideSupportFab ? null : <WhatsAppFloatingButton />}
      <Routes>
        <Route path="/" element={<SmartEntryRoute />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        {import.meta.env.DEV ? <Route path="/dev/ui-gallery" element={<DevUiGalleryPage />} /> : null}
        {/** /kid = KidModePage — approved videos play via `CleanPlayer` (no alternate embed on this route). */}
        <Route path="/kid" element={<KidModeRoute />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/set-parent-pin"
          element={
            <ProtectedRoute>
              <SetParentPinPage />
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/add-profile" element={<AddProfilePage />} />
          <Route path="/dashboard/manage/:deviceId" element={<ManageProfilePage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/hidden-videos" element={<HiddenVideosPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/devices" element={<Navigate to="/dashboard" replace />} />
          <Route path="/subscription" element={<SubscriptionPage />} />
        </Route>
        <Route path="*" element={<CatchAllRedirect />} />
      </Routes>
    </>
  )
}

export default function App() {
  useEffect(() => {
    // Render free tier puts the bridge to sleep after ~15 min idle, causing 40s+
    // cold starts on play. Keep it warm for the whole session, and re-warm when
    // the app returns to the foreground.
    preWarmMediaBridge()
    const KEEP_WARM_INTERVAL_MS = 10 * 60 * 1000
    const interval = window.setInterval(preWarmMediaBridge, KEEP_WARM_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') preWarmMediaBridge()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeAwareToaster />
        <TesterAccessGate>
          <AppChrome />
        </TesterAccessGate>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
