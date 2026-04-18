import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { normalizePairingUrlInAddressBar } from './lib/pairingCodeFromQr'
import App from './App.tsx'

normalizePairingUrlInAddressBar()

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
