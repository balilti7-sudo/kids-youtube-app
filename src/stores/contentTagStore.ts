import { create } from 'zustand'
import { CONTENT_TAGS_ENABLED } from '../config/contentTags'
import { isLocalParentSessionValid, readLocalParentSession } from '../lib/localParentAdmin'
import { humanizeSupabaseError } from '../lib/supabaseErrorMessage'
import { supabase } from '../lib/supabase'
import { mapContentTagRows } from '../lib/contentTags/tagCatalog'
import {
  mapDeviceContentPrefs,
  preferencesToRpcPayload,
  buildOptimisticTagPreferences,
} from '../lib/contentTags/tagPreferences'
import type { TagPreferenceInput } from '../lib/contentTags/types'
import {
  cacheContentTagCatalog,
  cacheDeviceContentPrefs,
  enqueueContentPrefsUpdate,
  readCachedContentTagCatalog,
  readCachedDeviceContentPrefs,
} from '../lib/contentTags/tagOfflineCache'
import type { ContentTag, DeviceContentPrefs } from '../lib/contentTags/types'

interface ContentTagState {
  enabled: boolean
  catalog: ContentTag[]
  catalogLoading: boolean
  catalogError: string | null
  /** deviceId → prefs snapshot */
  devicePrefs: Record<string, DeviceContentPrefs>
  devicePrefsLoading: Record<string, boolean>
  devicePrefsError: Record<string, string | null>
  fetchCatalog: () => Promise<{ error: Error | null; fromCache?: boolean }>
  fetchDevicePrefs: (deviceId: string) => Promise<{ error: Error | null; fromCache?: boolean }>
  updateTagPreferences: (
    deviceId: string,
    prefs: TagPreferenceInput[]
  ) => Promise<{ data: DeviceContentPrefs | null; error: Error | null; offlineQueued?: boolean }>
  setChannelTags: (
    deviceId: string,
    channelId: string,
    tagIds: string[]
  ) => Promise<{ data: DeviceContentPrefs | null; error: Error | null }>
  bulkSetChannelTags: (
    deviceId: string,
    channelIds: string[],
    tagIds: string[]
  ) => Promise<{ data: DeviceContentPrefs | null; error: Error | null }>
  createFamilyTag: (
    label: string,
    opts?: { iconKey?: string; colorToken?: string; deviceIdForRefresh?: string }
  ) => Promise<{ data: ContentTag | null; error: Error | null }>
  getDevicePrefs: (deviceId: string) => DeviceContentPrefs | null
  reset: () => void
}

const emptyPrefs = (): DeviceContentPrefs => ({ tagPreferences: [], channelTags: [] })

function mapFamilyTagRow(row: Record<string, unknown>): ContentTag | null {
  const id = row.id
  const slug = row.slug
  if (typeof id !== 'string' || typeof slug !== 'string') return null
  return {
    tagId: id,
    slug,
    label: row.label != null ? String(row.label) : null,
    iconKey: String(row.icon_key ?? row.iconKey ?? 'star'),
    colorToken: String(row.color_token ?? row.colorToken ?? 'tag-violet'),
    scope: 'family',
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 1000),
  }
}

function isTransientSaveError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('failed to connect') ||
    m.includes('network') ||
    m.includes('timeout') ||
    m.includes('522') ||
    m.includes('523') ||
    m.includes('502') ||
    m.includes('504') ||
    m.includes('fetch')
  )
}

async function loadDevicePrefsFromRpc(deviceId: string): Promise<{ data: DeviceContentPrefs | null; error: Error | null }> {
  const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null
  if (localSession?.accessToken) {
    const { data, error } = await supabase.rpc('local_parent_get_device_content_prefs', {
      p_access_token: localSession.accessToken,
    })
    if (error) return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
    const prefs = mapDeviceContentPrefs(data)
    cacheDeviceContentPrefs(deviceId, prefs)
    return { data: prefs, error: null }
  }

  const { data, error } = await supabase.rpc('parent_get_device_content_prefs', {
    p_device_id: deviceId,
  })
  if (error) return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
  const prefs = mapDeviceContentPrefs(data)
  cacheDeviceContentPrefs(deviceId, prefs)
  return { data: prefs, error: null }
}

export const useContentTagStore = create<ContentTagState>((set, get) => ({
  enabled: CONTENT_TAGS_ENABLED,
  catalog: [],
  catalogLoading: false,
  catalogError: null,
  devicePrefs: {},
  devicePrefsLoading: {},
  devicePrefsError: {},

  getDevicePrefs: (deviceId) => get().devicePrefs[deviceId] ?? null,

  reset: () =>
    set({
      catalog: [],
      catalogLoading: false,
      catalogError: null,
      devicePrefs: {},
      devicePrefsLoading: {},
      devicePrefsError: {},
    }),

  fetchCatalog: async () => {
    if (!CONTENT_TAGS_ENABLED) {
      return { error: null }
    }

    set({ catalogLoading: true, catalogError: null })
    const { data, error } = await supabase.rpc('list_content_tags')
    if (error) {
      const cached = readCachedContentTagCatalog()
      if (cached.length > 0) {
        set({ catalog: cached, catalogLoading: false, catalogError: humanizeSupabaseError(error.message) })
        return { error: null, fromCache: true }
      }
      const msg = humanizeSupabaseError(error.message)
      set({ catalogLoading: false, catalogError: msg })
      return { error: new Error(msg) }
    }

    const tags = mapContentTagRows(data)
    cacheContentTagCatalog(tags)
    set({ catalog: tags, catalogLoading: false, catalogError: null })
    return { error: null }
  },

  fetchDevicePrefs: async (deviceId) => {
    if (!CONTENT_TAGS_ENABLED) {
      return { error: null }
    }

    set((s) => ({
      devicePrefsLoading: { ...s.devicePrefsLoading, [deviceId]: true },
      devicePrefsError: { ...s.devicePrefsError, [deviceId]: null },
    }))

    const res = await loadDevicePrefsFromRpc(deviceId)
    if (res.error) {
      const errMsg = res.error.message
      const cached = readCachedDeviceContentPrefs(deviceId)
      if (cached) {
        set((s) => ({
          devicePrefs: { ...s.devicePrefs, [deviceId]: cached },
          devicePrefsLoading: { ...s.devicePrefsLoading, [deviceId]: false },
          devicePrefsError: { ...s.devicePrefsError, [deviceId]: errMsg },
        }))
        return { error: null, fromCache: true }
      }
      set((s) => ({
        devicePrefsLoading: { ...s.devicePrefsLoading, [deviceId]: false },
        devicePrefsError: { ...s.devicePrefsError, [deviceId]: errMsg },
      }))
      return { error: res.error }
    }

    const prefs = res.data ?? emptyPrefs()
    set((s) => ({
      devicePrefs: { ...s.devicePrefs, [deviceId]: prefs },
      devicePrefsLoading: { ...s.devicePrefsLoading, [deviceId]: false },
    }))
    return { error: null }
  },

  updateTagPreferences: async (deviceId, prefs) => {
    if (!CONTENT_TAGS_ENABLED) {
      return { data: null, error: null }
    }

    const catalog = get().catalog
    const prev = get().devicePrefs[deviceId] ?? emptyPrefs()
    const optimistic = buildOptimisticTagPreferences(catalog, prev.channelTags, prefs)
    cacheDeviceContentPrefs(deviceId, optimistic)
    set((s) => ({ devicePrefs: { ...s.devicePrefs, [deviceId]: optimistic } }))

    const payload = preferencesToRpcPayload(prefs)
    const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null

    const { data, error } = localSession?.accessToken
      ? await supabase.rpc('local_parent_update_device_tag_preferences', {
          p_access_token: localSession.accessToken,
          p_preferences: payload,
        })
      : await supabase.rpc('parent_update_device_tag_preferences', {
          p_device_id: deviceId,
          p_preferences: payload,
        })

    if (error) {
      if (isTransientSaveError(error.message)) {
        enqueueContentPrefsUpdate(deviceId, payload)
        return { data: optimistic, error: new Error(error.message), offlineQueued: true }
      }
      cacheDeviceContentPrefs(deviceId, prev)
      set((s) => ({ devicePrefs: { ...s.devicePrefs, [deviceId]: prev } }))
      return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
    }

    const mapped = mapDeviceContentPrefs(data)
    cacheDeviceContentPrefs(deviceId, mapped)
    set((s) => ({ devicePrefs: { ...s.devicePrefs, [deviceId]: mapped } }))
    return { data: mapped, error: null }
  },

  setChannelTags: async (deviceId, channelId, tagIds) => {
    if (!CONTENT_TAGS_ENABLED) {
      return { data: null, error: null }
    }

    const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null
    const { data, error } = localSession?.accessToken
      ? await supabase.rpc('local_parent_set_channel_tags', {
          p_access_token: localSession.accessToken,
          p_channel_id: channelId,
          p_tag_ids: tagIds,
        })
      : await supabase.rpc('parent_set_channel_tags', {
          p_device_id: deviceId,
          p_channel_id: channelId,
          p_tag_ids: tagIds,
        })

    if (error) {
      return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
    }

    const mapped = mapDeviceContentPrefs(data)
    cacheDeviceContentPrefs(deviceId, mapped)
    set((s) => ({ devicePrefs: { ...s.devicePrefs, [deviceId]: mapped } }))
    return { data: mapped, error: null }
  },

  bulkSetChannelTags: async (deviceId, channelIds, tagIds) => {
    if (!CONTENT_TAGS_ENABLED) {
      return { data: null, error: null }
    }

    const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null
    const { data, error } = localSession?.accessToken
      ? await supabase.rpc('local_parent_bulk_set_channel_tags', {
          p_access_token: localSession.accessToken,
          p_channel_ids: channelIds,
          p_tag_ids: tagIds,
        })
      : await supabase.rpc('parent_bulk_set_channel_tags', {
          p_device_id: deviceId,
          p_channel_ids: channelIds,
          p_tag_ids: tagIds,
        })

    if (error) {
      return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
    }

    const mapped = mapDeviceContentPrefs(data)
    cacheDeviceContentPrefs(deviceId, mapped)
    set((s) => ({ devicePrefs: { ...s.devicePrefs, [deviceId]: mapped } }))
    return { data: mapped, error: null }
  },

  createFamilyTag: async (label, opts) => {
    if (!CONTENT_TAGS_ENABLED) {
      return { data: null, error: null }
    }

    const localSession = isLocalParentSessionValid() ? readLocalParentSession() : null
    const { data, error } = localSession?.accessToken
      ? await supabase.rpc('local_parent_create_family_tag', {
          p_access_token: localSession.accessToken,
          p_label: label,
          p_icon_key: opts?.iconKey ?? 'star',
          p_color_token: opts?.colorToken ?? 'tag-violet',
        })
      : await supabase.rpc('parent_create_family_tag', {
          p_label: label,
          p_icon_key: opts?.iconKey ?? 'star',
          p_color_token: opts?.colorToken ?? 'tag-violet',
        })

    if (error) {
      return { data: null, error: new Error(humanizeSupabaseError(error.message)) }
    }

    const tag = mapFamilyTagRow((data ?? {}) as Record<string, unknown>)
    if (tag) {
      set((s) => ({
        catalog: [...s.catalog.filter((t) => t.tagId !== tag.tagId), tag].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug)
        ),
      }))
      cacheContentTagCatalog(get().catalog)
    }

    if (opts?.deviceIdForRefresh) {
      await get().fetchDevicePrefs(opts.deviceIdForRefresh)
    }

    return { data: tag, error: null }
  },
}))
