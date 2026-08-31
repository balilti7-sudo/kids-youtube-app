import { useMemo } from 'react'
import { CONTENT_TAGS_STRICT_MODE_DEFAULT } from '../config/contentTags'
import type { TagPreference } from '../lib/contentTags/types'
import { rankShortsLaneFeed, type ShortsLaneItem } from '../lib/shortsFeedRank'

export function useKidShortsFeed(
  pool: ShortsLaneItem[],
  tagPreferences: TagPreference[],
  activeTagSlug: string | null,
  seedVideoId: string | null
) {
  return useMemo(() => {
    const feed = rankShortsLaneFeed(pool, tagPreferences, {
      seedVideoId,
      filterSlug: activeTagSlug,
      strictMode: CONTENT_TAGS_STRICT_MODE_DEFAULT,
    })

    const seedIndex = seedVideoId
      ? feed.findIndex((item) => item.videoId === seedVideoId)
      : 0

    return {
      feed,
      seedIndex: seedIndex >= 0 ? seedIndex : 0,
    }
  }, [pool, tagPreferences, activeTagSlug, seedVideoId])
}
