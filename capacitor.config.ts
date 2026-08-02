import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.safetube.kids',
  appName: 'SafeTube',
  webDir: 'dist',
  android: {
    // googlevideo/InnerTube are all HTTPS; keep cleartext off.
    allowMixedContent: false,
  },
  server: {
    // Serve the bundled app over https://localhost so secure-context APIs
    // (crypto.subtle etc., needed by BotGuard) are available in the WebView.
    androidScheme: 'https',
  },
  plugins: {
    // Patch window.fetch / XHR through native HTTP so Media Bridge + Google APIs
    // are not blocked by WebView CORS on https://localhost.
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
