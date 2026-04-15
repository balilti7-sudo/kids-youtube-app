import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { AuthPage } from './pages/AuthPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { DeviceLinkPage } from './pages/DeviceLinkPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { SettingsPage } from './pages/SettingsPage'
import { KidModePage } from './pages/KidModePage'

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Toaster richColors position="top-center" dir="rtl" theme="dark" />
        <Routes>
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
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/devices" element={<DeviceLinkPage />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
