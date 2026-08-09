/**
 * Captures PNG screenshots into ui-screenshots/
 *
 *   node scripts/capture-ui-screenshots.mjs --web
 *   node scripts/capture-ui-screenshots.mjs --gallery
 *   node scripts/capture-ui-screenshots.mjs --android
 *   node scripts/capture-ui-screenshots.mjs --all
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = process.env.OUT_DIR || join(root, 'ui-screenshots')
const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')

const args = new Set(process.argv.slice(2))
const runWeb = args.has('--web') || args.has('--all')
const runGallery = args.has('--gallery') || args.has('--all') || (!args.has('--web') && !args.has('--android'))
const runAndroid = args.has('--android') || args.has('--all')

const WEB_ROUTES = [
  { id: 'route-root', path: '/', waitMs: 2000 },
  { id: 'route-auth', path: '/auth', waitMs: 1200 },
  { id: 'route-kid', path: '/kid', waitMs: 2200 },
  { id: 'route-channels', path: '/channels', waitMs: 1800 },
  { id: 'route-playlists', path: '/playlists', waitMs: 1500 },
  { id: 'route-dashboard-gate', path: '/dashboard', waitMs: 1800 },
  { id: 'route-settings-gate', path: '/settings', waitMs: 1800 },
]

async function withBrowser(fn) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL',
  })
  const page = await context.newPage()
  try {
    return await fn(page)
  } finally {
    await browser.close()
  }
}

async function captureWeb() {
  const dir = join(outDir, 'web')
  await mkdir(dir, { recursive: true })
  const index = []
  await withBrowser(async (page) => {
    for (const route of WEB_ROUTES) {
      const url = `${baseUrl}${route.path}`
      console.log(`web → ${route.id}`)
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForTimeout(route.waitMs)
        const file = `${route.id}.png`
        await page.screenshot({ path: join(dir, file), fullPage: true })
        index.push({ id: route.id, file: `web/${file}`, ok: true })
      } catch (e) {
        console.error(`  fail: ${e.message}`)
        index.push({ id: route.id, ok: false, error: String(e.message || e) })
      }
    }
    // Auth register tab
    try {
      await page.goto(`${baseUrl}/auth`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      await page.locator('button', { hasText: /^הרשמה$/ }).first().click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(dir, 'route-auth-register.png'), fullPage: true })
      index.push({ id: 'route-auth-register', file: 'web/route-auth-register.png', ok: true })
    } catch (e) {
      index.push({ id: 'route-auth-register', ok: false, error: String(e.message || e) })
    }
  })
  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`web: ${index.filter((x) => x.ok).length} files → ${dir}`)
}

async function captureGallery() {
  const dir = join(outDir, 'gallery')
  await mkdir(dir, { recursive: true })
  const index = []
  await withBrowser(async (page) => {
    await page.goto(`${baseUrl}/dev/ui-gallery`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(800)
    const hrefs = await page.$$eval('a[href*="shot="]', (as) =>
      as.map((a) => a.getAttribute('href')).filter(Boolean)
    )
    const shotIds = [...new Set(hrefs.map((h) => new URL(h, 'http://x').searchParams.get('shot')).filter(Boolean))]
    console.log(`gallery: ${shotIds.length} shots`)
    await page.screenshot({ path: join(dir, '00-index.png'), fullPage: true })
    index.push({ id: '00-index', file: 'gallery/00-index.png', ok: true })

    for (const id of shotIds) {
      console.log(`gallery → ${id}`)
      try {
        await page.goto(`${baseUrl}/dev/ui-gallery?shot=${encodeURIComponent(id)}`, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        })
        await page.waitForTimeout(1400)
        const file = `${id}.png`
        await page.screenshot({ path: join(dir, file), fullPage: false })
        index.push({ id, file: `gallery/${file}`, ok: true })
      } catch (e) {
        console.error(`  fail: ${e.message}`)
        index.push({ id, ok: false, error: String(e.message || e) })
      }
    }
  })
  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`gallery: ${index.filter((x) => x.ok).length} files → ${dir}`)
}

function adb(argv, opts = {}) {
  const r = spawnSync('adb', argv, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`adb ${argv.join(' ')} failed: ${r.stderr || r.stdout}`)
  }
  return r
}

async function captureAndroid() {
  const dir = join(outDir, 'android')
  await mkdir(dir, { recursive: true })
  const devices = adb(['devices']).stdout || ''
  if (!/(emulator-\d+|\w+)\s+device/.test(devices)) throw new Error('No adb device online')

  const index = []
  const shot = async (id, waitMs = 0) => {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs))
    const remote = '/sdcard/safetube_shot.png'
    adb(['shell', 'screencap', '-p', remote])
    const local = join(dir, `${id}.png`)
    adb(['pull', remote, local])
    adb(['shell', 'rm', remote], { allowFail: true })
    index.push({ id, file: `android/${id}.png`, ok: true })
    console.log(`android → ${id}`)
  }

  adb(['shell', 'am', 'force-stop', 'app.safetube.kids'], { allowFail: true })
  await new Promise((r) => setTimeout(r, 500))
  adb(['shell', 'am', 'start', '-n', 'app.safetube.kids/.MainActivity'], { allowFail: true })
  await shot('01-cold-start', 2500)
  await shot('02-after-splash', 3500)
  await shot('03-settled', 4000)

  // Tap center (often advances splash / focuses webview)
  adb(['shell', 'input', 'tap', '540', '1200'], { allowFail: true })
  await shot('04-after-tap', 2000)

  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2))
  console.log(`android: ${index.length} files → ${dir}`)
}

async function writeReadme() {
  const md = `# SafeTube UI screenshots

Generated for UI design review.

## Folders

| Folder | Source |
|--------|--------|
| \`android/\` | Physical emulator screencaps (\`adb screencap\`) of the installed APK |
| \`web/\` | Live app routes via Playwright (phone viewport) |
| \`gallery/\` | DEV UI gallery at \`/dev/ui-gallery\` — real components & dialogs with sample data |

## Regenerate

\`\`\`bash
npm run dev
# other terminal:
node scripts/capture-ui-screenshots.mjs --all
\`\`\`

Emulator must be running for \`--android\`. Gallery requires the Vite DEV server (not production build).
`
  await writeFile(join(outDir, 'README.md'), md)
}

await mkdir(outDir, { recursive: true })
if (runWeb) await captureWeb()
if (runGallery) await captureGallery()
if (runAndroid) {
  try {
    await captureAndroid()
  } catch (e) {
    console.error(`android skipped: ${e.message}`)
  }
}
await writeReadme()
console.log('Done →', outDir)
