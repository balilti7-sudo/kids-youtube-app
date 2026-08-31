import { useEffect, useState } from 'react'

type Rgb = { r: number; g: number; b: number }

const cache = new Map<string, Rgb | null>()

function hashFallbackColor(seed: string): Rgb {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hue = Math.abs(h) % 360
  // Soft mid-saturation tones that read well as ambient glow.
  const s = 0.42
  const l = 0.48
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function averageImageColor(url: string): Promise<Rgb | null> {
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try {
        const size = 16
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          const fb = hashFallbackColor(url)
          cache.set(url, fb)
          resolve(fb)
          return
        }
        ctx.drawImage(img, 0, 0, size, size)
        const { data } = ctx.getImageData(0, 0, size, size)
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] ?? 0
          if (a < 128) continue
          r += data[i] ?? 0
          g += data[i + 1] ?? 0
          b += data[i + 2] ?? 0
          n += 1
        }
        if (n === 0) {
          const fb = hashFallbackColor(url)
          cache.set(url, fb)
          resolve(fb)
          return
        }
        const rgb = {
          r: Math.round(r / n),
          g: Math.round(g / n),
          b: Math.round(b / n),
        }
        cache.set(url, rgb)
        resolve(rgb)
      } catch {
        const fb = hashFallbackColor(url)
        cache.set(url, fb)
        resolve(fb)
      }
    }
    img.onerror = () => {
      const fb = hashFallbackColor(url)
      cache.set(url, fb)
      resolve(fb)
    }
    // Prefer same-origin / CORS-friendly thumbs; failures fall back to hash glow.
    img.referrerPolicy = 'no-referrer'
    img.src = url
  })
}

/** One-shot dominant color from a poster URL (cached). Never samples the live video. */
export function useDominantPosterColor(posterUrl: string | null | undefined): Rgb | null {
  const url = (posterUrl || '').trim()
  const [rgb, setRgb] = useState<Rgb | null>(() => (url ? cache.get(url) ?? null : null))

  useEffect(() => {
    if (!url) {
      setRgb(null)
      return
    }
    let cancelled = false
    const hit = cache.get(url)
    if (hit !== undefined) {
      setRgb(hit)
      return
    }
    void averageImageColor(url).then((next) => {
      if (!cancelled) setRgb(next)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return rgb
}

export function rgbToCss(rgb: Rgb | null, alpha = 0.45): string | null {
  if (!rgb) return null
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}
