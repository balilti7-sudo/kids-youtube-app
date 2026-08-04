import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import { normalizePairingUrlInAddressBar } from './lib/pairingCodeFromQr'
import { installAuthDiagnostics } from './lib/authDiagnostics'
import { initTheme } from './lib/theme'
import { initCapacitorDeviceResolve } from './lib/deviceResolve/capacitorBridge'
import { initCapacitorAuthDeepLinks } from './lib/capacitorAuth'
import App from './App.tsx'

normalizePairingUrlInAddressBar()
installAuthDiagnostics()
initTheme()
initCapacitorDeviceResolve()
initCapacitorAuthDeepLinks()

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
