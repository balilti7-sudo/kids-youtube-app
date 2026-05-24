/**
 * Generates PWA / favicon PNGs from public/logo.png (shield mark on the left).
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
const iconMarkSvgPath = path.join(publicDir, 'icon-mark.svg')

/** YouTube-style dark — matches manifest background_color */
const BG = { r: 9, g: 9, b: 11, alpha: 1 }

async function loadSquareMark() {
  return sharp(iconMarkSvgPath).resize(512, 512).png().toBuffer()
}

async function writeSquareIcon(mark, size, outPath, { maskable = false } = {}) {
  if (!maskable) {
    await sharp(mark).resize(size, size).png().toFile(outPath)
    return
  }

  const inset = Math.round(size * 0.12)
  const inner = size - inset * 2
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([
      {
        input: await sharp(mark).resize(inner, inner, { fit: 'contain', background: BG }).png().toBuffer(),
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer()

  await writeFile(outPath, png)
}

async function writeFaviconIco(mark) {
  const sizes = [16, 32, 48]
  const pngs = []
  for (const size of sizes) {
    const inner = Math.round(size * 0.84)
    const innerBuf = await sharp(mark).resize(inner, inner, { fit: 'contain', background: BG }).png().toBuffer()
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
  const mark = await loadSquareMark()

  await writeSquareIcon(mark, 512, path.join(iconsDir, 'icon-512x512.png'))
  await writeSquareIcon(mark, 512, path.join(iconsDir, 'icon-512x512-maskable.png'), { maskable: true })
  await writeSquareIcon(mark, 192, path.join(iconsDir, 'icon-192x192.png'))
  await writeSquareIcon(mark, 192, path.join(iconsDir, 'icon-192x192-maskable.png'), { maskable: true })
  await writeSquareIcon(mark, 180, path.join(publicDir, 'apple-touch-icon.png'))
  await writeSquareIcon(mark, 32, path.join(publicDir, 'favicon-32x32.png'))
  await writeSquareIcon(mark, 16, path.join(publicDir, 'favicon-16x16.png'))
  await writeFaviconIco(mark)

  console.log('PWA icons written to public/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
