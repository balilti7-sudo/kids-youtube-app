/**
 * Generates PWA / favicon PNGs from public/logo.png.
 * Run: node scripts/generate-pwa-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const publicDir = path.join(root, 'public')
const iconsDir = path.join(publicDir, 'icons')
const logoPath = path.join(publicDir, 'logo.png')

/** YouTube-style dark — matches manifest background_color */
const BG = { r: 9, g: 9, b: 11, alpha: 1 }
const BLACK_THRESHOLD = 35

async function loadVisibleLogoCrop() {
  const input = await sharp(logoPath).ensureAlpha().png().toBuffer()
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * info.channels
      const r = data[idx] ?? 0
      const g = data[idx + 1] ?? 0
      const b = data[idx + 2] ?? 0
      const a = data[idx + 3] ?? 255
      if (a > 0 && (r > BLACK_THRESHOLD || g > BLACK_THRESHOLD || b > BLACK_THRESHOLD)) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (maxX < minX || maxY < minY) return input

  const padX = Math.round((maxX - minX + 1) * 0.06)
  const padY = Math.round((maxY - minY + 1) * 0.1)
  const left = Math.max(0, minX - padX)
  const top = Math.max(0, minY - padY)
  const right = Math.min(info.width, maxX + 1 + padX)
  const bottom = Math.min(info.height, maxY + 1 + padY)

  return sharp(input)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer()
}

async function writeSquareIcon(logoCrop, size, outPath, { maskable = false } = {}) {
  const fillRatio = maskable ? 0.74 : 0.86
  const inner = Math.round(size * fillRatio)
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([
      {
        input: await sharp(logoCrop).resize(inner, inner, { fit: 'inside' }).png().toBuffer(),
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer()

  await writeFile(outPath, png)
}

async function writeFaviconIco(logoCrop) {
  const sizes = [16, 32, 48]
  const pngs = []
  for (const size of sizes) {
    const inner = Math.round(size * 0.84)
    const innerBuf = await sharp(logoCrop).resize(inner, inner, { fit: 'inside' }).png().toBuffer()
    const png = await sharp({
      create: { width: size, height: size, channels: 4, background: BG },
    })
      .composite([{ input: innerBuf, gravity: 'centre' }])
      .png()
      .toBuffer()
    pngs.push(png)
  }

  await writeFile(path.join(publicDir, 'favicon.ico'), pngs[1])
}

async function main() {
  await mkdir(iconsDir, { recursive: true })
  const logoCrop = await loadVisibleLogoCrop()

  await writeSquareIcon(logoCrop, 512, path.join(iconsDir, 'icon-512x512.png'))
  await writeSquareIcon(logoCrop, 512, path.join(iconsDir, 'icon-512x512-maskable.png'), { maskable: true })
  await writeSquareIcon(logoCrop, 192, path.join(iconsDir, 'icon-192x192.png'))
  await writeSquareIcon(logoCrop, 192, path.join(iconsDir, 'icon-192x192-maskable.png'), { maskable: true })
  await writeSquareIcon(logoCrop, 180, path.join(publicDir, 'apple-touch-icon.png'))
  await writeSquareIcon(logoCrop, 32, path.join(publicDir, 'favicon-32x32.png'))
  await writeSquareIcon(logoCrop, 16, path.join(publicDir, 'favicon-16x16.png'))
  await writeFaviconIco(logoCrop)

  console.log('PWA icons written to public/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
