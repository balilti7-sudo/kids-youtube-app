import { useEffect, useMemo, useState } from 'react'

function probeThumbnailPortrait(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) {
        resolve(false)
        return
      }
      resolve(h / w >= 1.12)
    }
    img.onerror = () => resolve(false)
    img.src = url
  })
}

/** Detects portrait thumbnails client-side so vertical Shorts stay off the long-form shelf. */
export function usePortraitVideoThumbnailIds(
  videos: Array<{ youtube_video_id: string; thumbnail_url: string | null }>
): ReadonlySet<string> {
  const [portraitIds, setPortraitIds] = useState<ReadonlySet<string>>(() => new Set())
  const thumbSignature = useMemo(
    () => videos.map((v) => `${v.youtube_video_id}:${v.thumbnail_url ?? ''}`).join('|'),
    [videos]
  )

  useEffect(() => {
    let cancelled = false
    const withThumb = videos.filter((v) => v.thumbnail_url?.trim())
    if (withThumb.length === 0) {
      setPortraitIds(new Set())
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
      if (!cancelled) setPortraitIds(found)
    })()

    return () => {
      cancelled = true
    }
  }, [thumbSignature, videos])

  return portraitIds
}
