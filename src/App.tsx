import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { KidModePage } from './pages/KidModePage'
import { useAuth } from './hooks/useAuth'
import { BYPASS_AUTH } from './config/dev'

function SmartEntryRoute() {
  const { isAuthenticated, loading, profileLoading, profile } = useAuth()
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

  // Kid-first: אם זה מכשיר ילד מצומד, תמיד נכנסים קודם למסך הילד.
  if (hasKidToken) return <Navigate to="/kid" replace />
  if (!isAuthenticated) return <Navigate to="/auth" replace />
  if (profile && !profile.onboarding_done) return <Navigate to="/onboarding" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster richColors position="top-center" dir="rtl" theme="dark" />
        <Routes>
          <Route path="/" element={<SmartEntryRoute />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/kid" element={<KidModePage />} />
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
            <Route path="/devices" element={<DeviceLinkPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
