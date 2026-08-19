import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import { installAuthDiagnostics } from './lib/authDiagnostics'
import { hydrateChildAccessToken } from './lib/childDevice'
import { initTheme } from './lib/theme'
import { initCapacitorDeviceResolve } from './lib/deviceResolve/capacitorBridge'
import { initCapacitorAuthDeepLinks } from './lib/capacitorAuth'
import { initParentalControlNativeBridge } from './lib/parentalControlNative'
import { initDeviceSettingsSyncQueue } from './lib/deviceSettingsSyncQueue'
import { initSafeAreaInsets } from './lib/safeArea'
import { installSafeTubeSandboxGuards } from './lib/safeTubeSandbox'
import App from './App.tsx'

installAuthDiagnostics()
installSafeTubeSandboxGuards()
void hydrateChildAccessToken()
initTheme()
initSafeAreaInsets()
initCapacitorDeviceResolve()
initCapacitorAuthDeepLinks()
initParentalControlNativeBridge()
initDeviceSettingsSyncQueue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* נכשל בשקט — עדיין אפשר דפדפן רגיל */
    })
  })
}
