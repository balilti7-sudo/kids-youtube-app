import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  // Load `.env`, `.env.local`, etc. from the repo root (next to this file).
  envDir: projectRoot,
  server: {
    port: 5174,
    strictPort: true,
    // Dev: same-origin `/api/*` and `/health` → local Media Bridge (8787). Avoids CORS and
    // "Failed to fetch" when only the frontend port is open in the browser.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
