import { CONTENT_TAGS_STRICT_MODE_DEFAULT, TAG_WEIGHT } from '../config/contentTags'
import {
  SHORTS_LANE_MAX_CHANNEL_STREAK,
} from '../config/shortsLane'
import type { ChannelContentTag } from './contentTags/types'
import { buildTagWeightMaps, scoreChannelForBrowse, type TagWeightMaps } from './contentTags/tagBrowseRank'

export type ShortsLaneItem = {
  videoId: string
  title: string
  thumbnail: string | null
  youtubeChannelId: string
  channelName: string
  channelThumbnail: string | null
  channelTags: ChannelContentTag[]
  durationSeconds?: number | null
  publishedAt?: string | null
}

export type RankShortsLaneOptions = {
  seedVideoId?: string | null
  filterSlug?: string | null
  strictMode?: boolean
  maxChannelStreak?: number
}

function scoreShortItem(
  item: ShortsLaneItem,
  weights: TagWeightMaps
): number {
  const channelScore = scoreChannelForBrowse(
    {
      channelId: item.youtubeChannelId,
      youtubeChannelId: item.youtubeChannelId,
      channelName: item.channelName,
      channelThumbnail: item.channelThumbnail,
      tags: item.channelTags,
    },
    weights
  )

  let freshnessBonus = 0
  if (item.publishedAt) {
    const ageMs = Date.now() - new Date(item.publishedAt).getTime()
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      const days = ageMs / (1000 * 60 * 60 * 24)
      if (days <= 7) freshnessBonus = 0.35
      else if (days <= 30) freshnessBonus = 0.15
    }
  }

  return channelScore + freshnessBonus
}

function itemMatchesTagFilter(item: ShortsLaneItem, filterSlug: string | null): boolean {
  if (!filterSlug) return true
  return item.channelTags.some((t) => t.slug === filterSlug)
}

/** Prevent long streaks from one creator — swap in diversity when needed. */
export function applyChannelDiversity(
  items: ShortsLaneItem[],
  maxStreak = SHORTS_LANE_MAX_CHANNEL_STREAK
): ShortsLaneItem[] {
  if (items.length <= maxStreak) return items
  const result = [...items]

  for (let i = maxStreak; i < result.length; i++) {
    const channelId = result[i]?.youtubeChannelId
    if (!channelId) continue

    let streak = 1
    for (let j = i - 1; j >= 0 && result[j]?.youtubeChannelId === channelId; j--) {
      streak++
    }

    if (streak < maxStreak) continue

    const swapIdx = result.findIndex(
      (candidate, idx) => idx > i && candidate.youtubeChannelId !== channelId
    )
    if (swapIdx < 0) continue
    const tmp = result[i]!
    result[i] = result[swapIdx]!
    result[swapIdx] = tmp
  }

  return result
}

function rotateSeedFirst(items: ShortsLaneItem[], seedVideoId: string | null): ShortsLaneItem[] {
  if (!seedVideoId || items.length === 0) return items
  const idx = items.findIndex((item) => item.videoId === seedVideoId)
  if (idx <= 0) return items
  return [items[idx]!, ...items.slice(0, idx), ...items.slice(idx + 1)]
}

/**
 * Rank Shorts for the full-screen lane: taste boost → freshness → diversity mix.
 */
export function rankShortsLaneFeed(
  items: ShortsLaneItem[],
  tagPreferences: Array<{ tagId?: string; slug?: string; weight?: number }>,
  opts: RankShortsLaneOptions = {}
): ShortsLaneItem[] {
  const filterSlug = opts.filterSlug ?? null
  const strictMode = opts.strictMode ?? CONTENT_TAGS_STRICT_MODE_DEFAULT
  const maxStreak = opts.maxChannelStreak ?? SHORTS_LANE_MAX_CHANNEL_STREAK
  const weights = buildTagWeightMaps(tagPreferences)

  const scored = items
    .filter((item) => itemMatchesTagFilter(item, filterSlug))
    .map((item) => ({ item, score: scoreShortItem(item, weights) }))
    .filter(({ score }) => !(strictMode && score <= TAG_WEIGHT.HIDE))

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const pubA = a.item.publishedAt ? new Date(a.item.publishedAt).getTime() : 0
    const pubB = b.item.publishedAt ? new Date(b.item.publishedAt).getTime() : 0
    if (pubB !== pubA) return pubB - pubA
    return a.item.title.localeCompare(b.item.title, undefined, { sensitivity: 'base' })
  })

  const ranked = applyChannelDiversity(
    scored.map(({ item }) => item),
    maxStreak
  )

  return rotateSeedFirst(ranked, opts.seedVideoId ?? null)
}

export function buildShortsLaneItem(input: {
  videoId: string
  title: string
  thumbnail?: string | null
  youtubeChannelId: string
  channelName: string
  channelThumbnail?: string | null
  channelTags?: ChannelContentTag[]
  durationSeconds?: number | null
  publishedAt?: string | null
}): ShortsLaneItem {
  return {
    videoId: input.videoId,
    title: input.title,
    thumbnail: input.thumbnail ?? null,
    youtubeChannelId: input.youtubeChannelId,
    channelName: input.channelName,
    channelThumbnail: input.channelThumbnail ?? null,
    channelTags: input.channelTags ?? [],
    durationSeconds: input.durationSeconds ?? null,
    publishedAt: input.publishedAt ?? null,
  }
}

export function buildChannelTagMap(
  channels: Array<{ youtube_channel_id: string; tags?: ChannelContentTag[] }>
): Map<string, ChannelContentTag[]> {
  const map = new Map<string, ChannelContentTag[]>()
  for (const ch of channels) {
    map.set(ch.youtube_channel_id, Array.isArray(ch.tags) ? ch.tags : [])
  }
  return map
}
