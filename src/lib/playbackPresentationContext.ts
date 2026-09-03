import { getPlaybackContentShape } from './playbackContentShape'
import {
  enrichPortraitIdsForInference,
  inferPresentationShape,
  type PresentationShape,
} from './presentationShape'
import { getPlaybackPresentationShape, setPlaybackPresentationShape } from './playbackPresentationShape'

export type PlaybackPresentationContext = {
  youtubeVideoId: string
  thumbnail_url: string | null
  fromShortsPlaylist: boolean
}

let activeContext: PlaybackPresentationContext | null = null
let portraitThumbnailIds: ReadonlySet<string> = new Set()

export function setPlaybackPresentationContext(ctx: PlaybackPresentationContext): void {
  activeContext = {
    youtubeVideoId: ctx.youtubeVideoId.trim(),
    thumbnail_url: ctx.thumbnail_url,
    fromShortsPlaylist: ctx.fromShortsPlaylist,
  }
}

export function resetPlaybackPresentationContext(): void {
  activeContext = null
  portraitThumbnailIds = new Set()
}

/** Mirrors browse-grid portrait probe results for imperative expand routing. */
export function setPlaybackPortraitThumbnailIds(ids: ReadonlySet<string>): void {
  portraitThumbnailIds = ids
}

/**
 * Authoritative presentation shape at Expand tap — re-runs inferPresentationShape with
 * stored selected-video metadata, latest portrait probe set, and any already-loaded
 * thumbnail pixels (no async wait).
 */
export function resolvePresentationShapeForExpand(): PresentationShape {
  if (!activeContext?.youtubeVideoId) {
    return getPlaybackPresentationShape()
  }

  const portraitIds = enrichPortraitIdsForInference(
    activeContext.youtubeVideoId,
    activeContext.thumbnail_url,
    portraitThumbnailIds
  )

  const resolved = inferPresentationShape({
    youtubeVideoId: activeContext.youtubeVideoId,
    thumbnail_url: activeContext.thumbnail_url,
    fromShortsPlaylist: activeContext.fromShortsPlaylist,
    contentShape: getPlaybackContentShape(),
    portraitThumbnailIds: portraitIds,
  })

  setPlaybackPresentationShape(resolved)
  return resolved
}
