import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { ThemeAwareToaster } from './components/theme/ThemeAwareToaster'
import { SplashScreen } from './components/branding/SplashScreen'
import { AuthPage } from './pages/AuthPage'
import AuthCallback from './pages/AuthCallback'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { PlaylistsPage } from './pages/PlaylistsPage'
import { HiddenVideosPage } from './pages/HiddenVideosPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { KidModePage } from './pages/KidModePage'
import { SetParentPinPage } from './pages/SetParentPinPage'
import { useAuth } from './hooks/useAuth'
import { BYPASS_AUTH } from './config/dev'
import { isProfileParentPinMissing } from './lib/parentPin'
import { parsePairingCodeFromLocationSearch } from './lib/pairingCodeFromQr'
import { WhatsAppFloatingButton } from './components/support/WhatsAppFloatingButton'
import { preWarmMediaBridge } from './lib/streamApi'

/** Remount כשמשנים query (למשל אחרי סריקת QR) כדי ש־boot עם קוד ירוץ שוב */
function KidModeRoute() {
  const [searchParams] = useSearchParams()
  return <KidModePage key={searchParams.toString()} />
}

function SmartEntryRoute() {
  const location = useLocation()
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()
  const pairFromUrl = parsePairingCodeFromLocationSearch(location.search, location.hash)
  if (pairFromUrl) {
    return <Navigate to={`/kid?code=${encodeURIComponent(pairFromUrl)}`} replace />
  }

  const hasKidToken =
    typeof window !== 'undefined' && Boolean(window.localStorage.getItem('safetube_kid_access_token'))

  if (BYPASS_AUTH) return <Navigate to="/dashboard" replace />

  if (loading) {
    return <SplashScreen />
  }

  if (isAuthenticated && profileLoading) {
    return <SplashScreen />
  }

  // מצב ילד בראש רק כשאין סשן הורה: על מכשיר הילד ההורה מתחבר כאן ומגדיר — לא ננעל מחוץ ללוח בגלל טוקן הילד ב־localStorage.
  if (!isAuthenticated && hasKidToken) return <Navigate to="/kid" replace />
  if (!isAuthenticated) return <Navigate to="/auth" replace />
  if (profile && !profile.onboarding_done) return <Navigate to="/onboarding" replace />
  if (isProfileParentPinMissing(profile)) return <Navigate to="/set-parent-pin" replace />
  return <Navigate to="/dashboard" replace />
}

/** מסלול לא ידוע: לא לאבד ?code= — מפנה ל־/kid או ל־/ */
function CatchAllRedirect() {
  const location = useLocation()
  const pair = parsePairingCodeFromLocationSearch(location.search, location.hash)
  if (pair) {
    return <Navigate to={`/kid?code=${encodeURIComponent(pair)}`} replace />
  }
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
    preWarmMediaBridge()
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeAwareToaster />
        <AppChrome />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
