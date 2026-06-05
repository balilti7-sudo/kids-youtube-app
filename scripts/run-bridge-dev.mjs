/**
 * Start Media Bridge on PORT 8787 (matches vite.config.ts proxy target).
 * Usage: npm run dev:api
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')

const env = {
  ...process.env,
  PORT: process.env.PORT?.trim() || '8787',
  HOST: process.env.HOST?.trim() || '0.0.0.0',
}

const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env,
  shell: true,
})

child.on('exit', (code) => process.exit(code ?? 1))
