/**
 * Builds the source images @capacitor/assets expects (resources/) from the
 * existing SafeTube brand files, then the generator turns them into Android
 * launcher icons (all densities + adaptive) and splash screens.
 *
 * Run: node scripts/generate-android-assets.mjs && npx capacitor-assets generate --android --assetPath resources
 */
import sharp from 'sharp'
import { copyFileSync, mkdirSync } from 'node:fs'

const BLACK = { r: 0, g: 0, b: 0, alpha: 1 }
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

mkdirSync('resources', { recursive: true })

// Legacy square icon (pre-adaptive launchers): the square brand icon, upscaled.
await sharp('public/icons/icon-512x512.png')
  .resize(1024, 1024, { kernel: 'lanczos3' })
  .png()
  .toFile('resources/icon-only.png')

// Adaptive icon foreground: square icon scaled to ~62% so nothing falls outside
// the launcher mask's safe zone. Its baked-in black square blends invisibly
// into the black background layer below.
const fg = await sharp('public/icons/icon-512x512.png')
  .resize(635, 635, { kernel: 'lanczos3' })
  .png()
  .toBuffer()
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: TRANSPARENT } })
  .composite([{ input: fg, gravity: 'center' }])
  .png()
  .toFile('resources/icon-foreground.png')

// Adaptive icon background: solid black, matching the icon artwork.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BLACK } })
  .png()
  .toFile('resources/icon-background.png')

// Splash: horizontal SafeTube lockup centered on black.
const splashLogo = await sharp('public/logo.png').resize({ width: 1100 }).png().toBuffer()
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BLACK } })
  .composite([{ input: splashLogo, gravity: 'center' }])
  .png()
  .toFile('resources/splash.png')
copyFileSync('resources/splash.png', 'resources/splash-dark.png')

console.log('resources/ ready: icon-only, icon-foreground, icon-background, splash, splash-dark')
