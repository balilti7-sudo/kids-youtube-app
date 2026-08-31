import type { TagWeight } from '../../config/contentTags'

export type ContentTagScope = 'system' | 'family'

/** Row from list_content_tags / embedded in prefs payloads. */
export type ContentTag = {
  tagId: string
  slug: string
  label: string | null
  iconKey: string
  colorToken: string
  scope: ContentTagScope
  sortOrder: number
}

export type TagPreference = ContentTag & {
  weight: TagWeight
}

export type ChannelTagAssignment = {
  channelId: string
  tags: ContentTag[]
}

export type DeviceContentPrefs = {
  tagPreferences: TagPreference[]
  channelTags: ChannelTagAssignment[]
}

export type TagPreferenceInput = {
  tagId: string
  weight: TagWeight
}

/** Optional tags on child allowed-channel rows (Phase 1+). */
export type ChannelContentTag = Pick<
  ContentTag,
  'tagId' | 'slug' | 'label' | 'iconKey' | 'colorToken' | 'scope'
>

export function isSystemTag(tag: Pick<ContentTag, 'scope'>): boolean {
  return tag.scope === 'system'
}

export function tagUsesI18nLabel(tag: Pick<ContentTag, 'scope' | 'label'>): boolean {
  return tag.scope === 'system' || !tag.label
}
