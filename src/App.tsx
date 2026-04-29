import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { LoadingSpinner } from './components/ui/LoadingSpinner'
import { AuthPage } from './pages/AuthPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { DeviceLinkPage } from './pages/DeviceLinkPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProfilePage } from './pages/ProfilePage'
import { KidModePage } from './pages/KidModePage'
import { useAuth } from './hooks/useAuth'
import { BYPASS_AUTH } from './config/dev'
import { parsePairingCodeFromLocationSearch } from './lib/pairingCodeFromQr'

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

  if (loading || (isAuthenticated && profileLoading)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingSpinner className="h-10 w-10" />
      </div>
    )
  }

  // מצב ילד בראש רק כשאין סשן הורה: על מכשיר הילד ההורה מתחבר כאן ומגדיר — לא ננעל מחוץ ללוח בגלל טוקן הילד ב־localStorage.
  if (!isAuthenticated && hasKidToken) return <Navigate to="/kid" replace />
  if (!isAuthenticated) return <Navigate to="/auth" replace />
  if (profile && !profile.onboarding_done) return <Navigate to="/onboarding" replace />
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

/** לוג דיבוג לפי דרישה — אחרי שינויי ניתוב */
function PairingCodeUrlLogger() {
  const location = useLocation()
  useEffect(() => {
    const code = parsePairingCodeFromLocationSearch(location.search, location.hash)
    // eslint-disable-next-line no-console -- דיבוג זמני לפי דרישת מוצר
    console.log('Detected code in URL: ' + (code ?? '(none)'))
  }, [location.pathname, location.search, location.hash])
  return null
}

export default function App() {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      console.log('REAL CLICK TARGET:', e.target)
    }
    document.addEventListener('click', handler, true)
    return () => {
      document.removeEventListener('click', handler, true)
    }
  }, [])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <PairingCodeUrlLogger />
        <Toaster richColors position="top-center" dir="rtl" theme="dark" />
        <Routes>
          <Route path="/" element={<SmartEntryRoute />} />
          <Route path="/auth" element={<AuthPage />} />
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
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/devices" element={<DeviceLinkPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Route>
          <Route path="*" element={<CatchAllRedirect />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
