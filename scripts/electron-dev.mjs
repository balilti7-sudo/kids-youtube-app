/**
 * One-command Electron dev launcher: starts the Vite dev server, waits until it responds,
 * then opens the Electron window pointed at it. Ctrl+C stops both.
 *
 * Run on a RESIDENTIAL machine (home/office internet) — that's the whole point of the
 * on-device architecture. Requires `npm install` in both the repo root and `server/`.
 */
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const VITE_URL = 'http://localhost:5174'
const isWindows = process.platform === 'win32'

function run(cmd, args, extraEnv = {}) {
  return spawn(cmd, args, {
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, ...extraEnv },
  })
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (res.ok || res.status === 200) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const vite = run('npm', ['run', 'dev'])
let electron = null

function shutdown() {
  try { electron?.kill() } catch { /* ignore */ }
  try { vite?.kill() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log(`[electron-dev] waiting for Vite at ${VITE_URL} …`)
if (!(await waitForServer(VITE_URL))) {
  console.error('[electron-dev] Vite did not start in time — is port 5174 free?')
  shutdown()
}

console.log('[electron-dev] Vite is up — launching Electron')
electron = run(electronPath, ['electron/main.cjs'], { ELECTRON_START_URL: VITE_URL })
electron.on('close', shutdown)
vite.on('close', shutdown)
