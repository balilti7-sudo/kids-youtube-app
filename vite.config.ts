import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** Media Bridge listen address for local dev (`npm run dev:api` → port 8787). */
const DEFAULT_BRIDGE_PROXY_TARGET = 'http://127.0.0.1:8787'

/**
 * Local search/stream: set `VITE_STREAM_API_USE_VITE_PROXY=true` in `.env.development`
 * (see `.env.example`). The client calls same-origin `/api/*`; this proxy forwards to the bridge.
 * Override target: `VITE_MEDIA_BRIDGE_PROXY_TARGET=http://127.0.0.1:8787`
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const bridgeProxyTarget =
    env.VITE_MEDIA_BRIDGE_PROXY_TARGET?.trim() || DEFAULT_BRIDGE_PROXY_TARGET
  const useViteProxy =
    env.VITE_STREAM_API_USE_VITE_PROXY === 'true' ||
    env.VITE_STREAM_API_USE_VITE_PROXY === '1'

  if (mode === 'development' && useViteProxy) {
    console.info(
      `[vite] Media Bridge proxy: /api, /health → ${bridgeProxyTarget} (VITE_STREAM_API_USE_VITE_PROXY=true)`
    )
  }

  return {
    plugins: [react()],
    // Load `.env`, `.env.local`, `.env.development`, etc. from the repo root.
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
