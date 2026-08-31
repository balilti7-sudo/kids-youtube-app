/**
 * Content tag / taste system feature flag.
 * Disabled — topic tags are not offered in the parent UI.
 * Set VITE_CONTENT_TAGS_ENABLED=true to re-enable.
 */
export const CONTENT_TAGS_ENABLED =
  import.meta.env.VITE_CONTENT_TAGS_ENABLED === 'true' ||
  import.meta.env.VITE_CONTENT_TAGS_ENABLED === '1'

/** Default strict mode — off unless parent explicitly enables in Phase 3. */
export const CONTENT_TAGS_STRICT_MODE_DEFAULT = false

/** Taste weight scale (matches DB CHECK constraint). */
export const TAG_WEIGHT = {
  HIDE: -2,
  LESS: -1,
  NEUTRAL: 0,
  MORE: 1,
  BOOST: 2,
} as const

export type TagWeight = (typeof TAG_WEIGHT)[keyof typeof TAG_WEIGHT]
