import type { TagWeight } from '../../config/contentTags'
import type {
  ChannelContentTag,
  ChannelTagAssignment,
  ContentTag,
  DeviceContentPrefs,
  TagPreference,
  TagPreferenceInput,
} from './types'

function mapEmbeddedTag(raw: unknown): ContentTag | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const tagId = row.tag_id ?? row.tagId
  const slug = row.slug
  if (typeof tagId !== 'string' || typeof slug !== 'string') return null
  return {
    tagId,
    slug,
    label: row.label != null && String(row.label).trim() ? String(row.label) : null,
    iconKey: String(row.icon_key ?? row.iconKey ?? 'tag'),
    colorToken: String(row.color_token ?? row.colorToken ?? 'tag-sky'),
    scope: row.scope === 'family' ? 'family' : 'system',
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 100),
  }
}

export function mapDeviceContentPrefs(data: unknown): DeviceContentPrefs {
  const empty: DeviceContentPrefs = { tagPreferences: [], channelTags: [] }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty
  const row = data as Record<string, unknown>

  const tagPreferences: TagPreference[] = []
  const prefRaw = row.tag_preferences ?? row.tagPreferences
  if (Array.isArray(prefRaw)) {
    for (const item of prefRaw) {
      const tag = mapEmbeddedTag(item)
      if (!tag) continue
      const weight = Number((item as Record<string, unknown>).weight ?? 0)
      if (!Number.isFinite(weight)) continue
      tagPreferences.push({ ...tag, weight: Math.max(-2, Math.min(2, Math.round(weight))) as TagWeight })
    }
  }

  const channelTags: ChannelTagAssignment[] = []
  const channelRaw = row.channel_tags ?? row.channelTags
  if (Array.isArray(channelRaw)) {
    for (const item of channelRaw) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const channelId = entry.channel_id ?? entry.channelId
      if (typeof channelId !== 'string') continue
      const tagsRaw = entry.tags
      const tags: ContentTag[] = Array.isArray(tagsRaw)
        ? tagsRaw.map(mapEmbeddedTag).filter((t): t is ContentTag => t !== null)
        : []
      channelTags.push({ channelId, tags })
    }
  }

  tagPreferences.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
  channelTags.sort((a, b) => a.channelId.localeCompare(b.channelId))

  return { tagPreferences, channelTags }
}

export function mapChannelContentTags(raw: unknown): ChannelContentTag[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const tag = mapEmbeddedTag(item)
      if (!tag) return null
      return {
        tagId: tag.tagId,
        slug: tag.slug,
        label: tag.label,
        iconKey: tag.iconKey,
        colorToken: tag.colorToken,
        scope: tag.scope,
      }
    })
    .filter((t): t is ChannelContentTag => t !== null)
}

export function preferencesToRpcPayload(prefs: TagPreferenceInput[]): Array<{ tag_id: string; weight: number }> {
  return prefs
    .filter((p) => p.tagId && p.weight !== 0)
    .map((p) => ({ tag_id: p.tagId, weight: p.weight }))
}

export function channelTagsToMap(channelTags: ChannelTagAssignment[]): Map<string, ContentTag[]> {
  return new Map(channelTags.map((c) => [c.channelId, c.tags]))
}

export function buildOptimisticTagPreferences(
  catalog: ContentTag[],
  existingChannelTags: ChannelTagAssignment[],
  inputs: TagPreferenceInput[]
): DeviceContentPrefs {
  const weightById = new Map(inputs.map((p) => [p.tagId, p.weight]))
  const tagPreferences = catalog
    .filter((t) => weightById.has(t.tagId) && weightById.get(t.tagId) !== 0)
    .map((t) => ({ ...t, weight: weightById.get(t.tagId)! }))
  return {
    tagPreferences,
    channelTags: existingChannelTags,
  }
}
