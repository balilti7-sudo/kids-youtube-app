import type { ContentTag } from './types'

function mapTagRow(row: Record<string, unknown>): ContentTag | null {
  const tagId = row.tag_id ?? row.tagId ?? row.id
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

export function mapContentTagRows(data: unknown): ContentTag[] {
  if (!Array.isArray(data)) return []
  return data
    .map((row) => mapTagRow(row as Record<string, unknown>))
    .filter((t): t is ContentTag => t !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug))
}

export function indexTagsById(tags: ContentTag[]): Map<string, ContentTag> {
  return new Map(tags.map((t) => [t.tagId, t]))
}

export function indexTagsBySlug(tags: ContentTag[]): Map<string, ContentTag> {
  return new Map(tags.map((t) => [t.slug, t]))
}
