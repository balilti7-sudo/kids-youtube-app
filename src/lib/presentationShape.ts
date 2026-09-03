import type { ContentShape } from './videoFormatClassification'
import { thumbnailSuggestsYoutubeShort } from './videoFormatClassification'

/** Same threshold as usePortraitVideoThumbnailIds probeThumbnailPortrait. */
export const PORTRAIT_THUMB_MIN_HEIGHT_RATIO = 1.12

/** Layout / theater geometry only — independent of Short product classification. */
export type PresentationShape = 'portrait' | 'landscape'

export type PresentationShapeInput = {
  youtubeVideoId?: string | null
  thumbnail_url?: string | null
  fromShortsPlaylist?: boolean
  contentShape: ContentShape
  /** Client-side portrait thumbnail probe (see usePortraitVideoThumbnailIds). */
  portraitThumbnailIds?: ReadonlySet<string>
}

/**
 * Infer portrait vs landscape presentation from existing metadata signals.
 * Does not use duration, DOM, or iframe dimensions.
 */
export function inferPresentationShape(input: PresentationShapeInput): PresentationShape {
  const id = input.youtubeVideoId?.trim()
  if (id && input.portraitThumbnailIds?.has(id)) return 'portrait'
  if (thumbnailSuggestsYoutubeShort(input.thumbnail_url)) return 'portrait'
  if (input.fromShortsPlaylist) return 'portrait'
  if (input.contentShape === 'short') return 'portrait'
  return 'landscape'
}

export function dimensionsSuggestPortrait(width: number, height: number): boolean {
  if (!width || !height) return false
  return height / width >= PORTRAIT_THUMB_MIN_HEIGHT_RATIO
}

/**
 * If the async portrait probe has not finished, use an already-loaded browse/player
 * thumbnail (grid card) — same pixel rule as the probe hook, no second inference model.
 */
export function enrichPortraitIdsForInference(
  youtubeVideoId: string,
  thumbnailUrl: string | null | undefined,
  portraitIds: ReadonlySet<string>
): ReadonlySet<string> {
  const id = youtubeVideoId.trim()
  if (!id || portraitIds.has(id)) return portraitIds

  const url = (thumbnailUrl ?? '').trim()
  if (!url && typeof document === 'undefined') return portraitIds

  for (const img of document.querySelectorAll('img')) {
    if (!img.complete) continue
    const src = img.currentSrc || img.src
    if (!src) continue
    const matches =
      (url && src === url) ||
      src.includes(id) ||
      (url && src.includes(url))
    if (!matches) continue
    if (dimensionsSuggestPortrait(img.naturalWidth, img.naturalHeight)) {
      return new Set([...portraitIds, id])
    }
    return portraitIds
  }

  return portraitIds
}
