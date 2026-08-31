import { CONTENT_TAGS_STRICT_MODE_DEFAULT, TAG_WEIGHT } from '../../config/contentTags'
import type { ChannelContentTag } from './types'

export type KidBrowseChannel = {
  channelId: string
  youtubeChannelId: string
  channelName: string
  channelThumbnail: string | null
  tags: ChannelContentTag[]
}

export type TagWeightMaps = {
  byTagId: Map<string, number>
  bySlug: Map<string, number>
}

export type RankChannelsOptions = {
  filterSlug?: string | null
  strictMode?: boolean
}

function normalizeTags(tags: ChannelContentTag[] | undefined): ChannelContentTag[] {
  return Array.isArray(tags) ? tags : []
}

/** Build lookup maps from parent taste preferences (slug + id). */
export function buildTagWeightMaps(
  prefs: Array<{ tagId?: string; slug?: string; weight?: number }>
): TagWeightMaps {
  const byTagId = new Map<string, number>()
  const bySlug = new Map<string, number>()
  for (const pref of prefs) {
    const weight = Number(pref.weight ?? 0)
    if (!Number.isFinite(weight) || weight === 0) continue
    const clamped = Math.max(-2, Math.min(2, Math.round(weight)))
    if (pref.tagId) byTagId.set(pref.tagId, clamped)
    if (pref.slug) bySlug.set(pref.slug, clamped)
  }
  return { byTagId, bySlug }
}

export function channelHasTagSlug(channel: KidBrowseChannel, slug: string): boolean {
  if (!slug) return true
  return normalizeTags(channel.tags).some((t) => t.slug === slug)
}

/** Score a channel from parent taste weights on its assigned tags. */
export function scoreChannelForBrowse(channel: KidBrowseChannel, weights: TagWeightMaps): number {
  const tags = normalizeTags(channel.tags)
  if (tags.length === 0) return TAG_WEIGHT.NEUTRAL

  let max: number = TAG_WEIGHT.NEUTRAL
  let min: number = TAG_WEIGHT.NEUTRAL
  for (const tag of tags) {
    const w =
      weights.byTagId.get(tag.tagId) ??
      weights.bySlug.get(tag.slug) ??
      TAG_WEIGHT.NEUTRAL
    max = Math.max(max, w)
    min = Math.min(min, w)
  }
  if (min <= TAG_WEIGHT.HIDE) return TAG_WEIGHT.HIDE
  if (max >= TAG_WEIGHT.BOOST) return TAG_WEIGHT.BOOST
  if (max >= TAG_WEIGHT.MORE) return TAG_WEIGHT.MORE
  if (min <= TAG_WEIGHT.LESS) return TAG_WEIGHT.LESS
  return TAG_WEIGHT.NEUTRAL
}

export function toKidBrowseChannel(input: {
  channel_id: string
  youtube_channel_id: string
  channel_name: string
  channel_thumbnail?: string | null
  tags?: ChannelContentTag[]
}): KidBrowseChannel {
  return {
    channelId: input.channel_id,
    youtubeChannelId: input.youtube_channel_id,
    channelName: input.channel_name,
    channelThumbnail: input.channel_thumbnail ?? null,
    tags: normalizeTags(input.tags),
  }
}

/** Unique tags present on at least one channel — for kid filter pills. */
export function collectFilterTagsFromChannels(channels: KidBrowseChannel[]): ChannelContentTag[] {
  const bySlug = new Map<string, ChannelContentTag>()
  for (const ch of channels) {
    for (const tag of normalizeTags(ch.tags)) {
      if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag)
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

export function rankChannelsForBrowse(
  channels: KidBrowseChannel[],
  weights: TagWeightMaps,
  opts: RankChannelsOptions = {}
): KidBrowseChannel[] {
  const filterSlug = opts.filterSlug ?? null
  const strictMode = opts.strictMode ?? CONTENT_TAGS_STRICT_MODE_DEFAULT

  const scored = channels
    .map((ch) => ({ ch, score: scoreChannelForBrowse(ch, weights) }))
    .filter(({ ch, score }) => {
      if (filterSlug && !channelHasTagSlug(ch, filterSlug)) return false
      if (strictMode && score <= TAG_WEIGHT.HIDE) return false
      return true
    })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.ch.channelName.localeCompare(b.ch.channelName, undefined, { sensitivity: 'base' })
  })

  return scored.map(({ ch }) => ch)
}

/** Channels boosted by parent taste (More / Boost) — excludes hidden. */
export function getRecommendedChannels(
  channels: KidBrowseChannel[],
  weights: TagWeightMaps,
  limit = 12
): KidBrowseChannel[] {
  const boosted = channels
    .map((ch) => ({ ch, score: scoreChannelForBrowse(ch, weights) }))
    .filter(({ score }) => score >= TAG_WEIGHT.MORE)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.ch.channelName.localeCompare(b.ch.channelName, undefined, { sensitivity: 'base' })
    })

  return boosted.slice(0, limit).map(({ ch }) => ch)
}

export function shouldShowKidContentBrowse(channels: KidBrowseChannel[]): boolean {
  return channels.some((c) => normalizeTags(c.tags).length > 0)
}
