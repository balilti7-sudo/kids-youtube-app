import { useEffect, useMemo, useState } from 'react'
import { dimensionsSuggestPortrait } from '../lib/presentationShape'

function probeThumbnailPortrait(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      resolve(dimensionsSuggestPortrait(img.naturalWidth, img.naturalHeight))
    }
    img.onerror = () => resolve(false)
    img.src = url
  })
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/** Detects portrait thumbnails client-side so vertical Shorts stay off the long-form shelf. */
export function usePortraitVideoThumbnailIds(
  videos: Array<{ youtube_video_id: string; thumbnail_url: string | null }>
): ReadonlySet<string> {
  const [portraitIds, setPortraitIds] = useState<ReadonlySet<string>>(() => new Set())
  // Signature-only deps — enrich/metadata updates must not re-probe and reshuffle the grid.
  const thumbSignature = useMemo(
    () => videos.map((v) => `${v.youtube_video_id}:${v.thumbnail_url ?? ''}`).join('|'),
    [videos]
  )

  useEffect(() => {
    let cancelled = false
    if (!thumbSignature) {
      setPortraitIds((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }

    const entries = thumbSignature.split('|').map((part) => {
      const idx = part.indexOf(':')
      return {
        youtube_video_id: part.slice(0, idx),
        thumbnail_url: part.slice(idx + 1) || null,
      }
    })
    const withThumb = entries.filter((v) => v.thumbnail_url?.trim())
    if (withThumb.length === 0) {
      setPortraitIds((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }

    void (async () => {
      const found = new Set<string>()
      await Promise.all(
        withThumb.map(async (video) => {
          const portrait = await probeThumbnailPortrait(video.thumbnail_url!.trim())
          if (portrait) found.add(video.youtube_video_id)
        })
      )
      if (cancelled) return
      setPortraitIds((prev) => (setsEqual(prev, found) ? prev : found))
    })()

    return () => {
      cancelled = true
    }
  }, [thumbSignature])

  return portraitIds
}
