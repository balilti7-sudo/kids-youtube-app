import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** Media Bridge listen address for local dev (`npm run dev:api` → port 8787). */
const DEFAULT_BRIDGE_PROXY_TARGET = 'http://127.0.0.1:8787'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const bridgeProxyTarget =
    env.VITE_MEDIA_BRIDGE_PROXY_TARGET?.trim() || DEFAULT_BRIDGE_PROXY_TARGET

  return {
    plugins: [react()],
    // Load `.env`, `.env.local`, etc. from the repo root (next to this file).
    envDir: projectRoot,
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].[hash].js',
          chunkFileNames: 'assets/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
        },
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      // Dev: same-origin `/api/*` and `/health` → local Media Bridge (8787).
      proxy: {
        '/api': {
          target: bridgeProxyTarget,
          changeOrigin: true,
        },
        '/health': {
          target: bridgeProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
