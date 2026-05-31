import { supabase } from './supabase'

const ACTIVE_CHILD_PROFILE_ID_KEY = 'safetube_active_child_profile_id'

export const ACTIVE_CHILD_PROFILE_CHANGED_EVENT = 'safetube-active-child-profile-changed'

export function getSavedActiveChildProfileId() {
  try {
    return localStorage.getItem(ACTIVE_CHILD_PROFILE_ID_KEY)
  } catch {
    return null
  }
}

export function saveActiveChildProfileId(deviceId: string) {
  try {
    localStorage.setItem(ACTIVE_CHILD_PROFILE_ID_KEY, deviceId)
    window.dispatchEvent(new CustomEvent(ACTIVE_CHILD_PROFILE_CHANGED_EVENT, { detail: { deviceId } }))
  } catch {
    /* ignore storage errors */
  }
}

export function clearActiveChildProfileIdIfMatches(deviceId: string) {
  try {
    if (getSavedActiveChildProfileId() === deviceId) {
      localStorage.removeItem(ACTIVE_CHILD_PROFILE_ID_KEY)
      window.dispatchEvent(new CustomEvent(ACTIVE_CHILD_PROFILE_CHANGED_EVENT, { detail: { deviceId: null } }))
    }
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Resolve devices.id for the logged-in owner: prop → localStorage → first device in DB.
 */
export async function resolveOwnerActiveDeviceId(
  preferredDeviceId: string | null | undefined
): Promise<string | null> {
  const savedId = getSavedActiveChildProfileId()?.trim() || null
  const immediate = preferredDeviceId?.trim() || savedId
  const { data: sessionWrap } = await supabase.auth.getSession()
  const userId = sessionWrap.session?.user?.id
  if (!userId) return immediate

  const candidates = [preferredDeviceId?.trim(), savedId].filter(Boolean) as string[]
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('devices')
      .select('id')
      .eq('user_id', userId)
      .eq('id', candidate)
      .maybeSingle()
    if (error) {
      console.warn('[activeDeviceSelection] device lookup failed', candidate, error.message)
      continue
    }
    if (data?.id) return data.id
  }

  const { data: rows, error } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.warn('[activeDeviceSelection] list devices failed', error.message)
    return immediate
  }

  const fallback = rows?.[0]?.id ?? null
  if (fallback && fallback !== savedId) {
    saveActiveChildProfileId(fallback)
  }
  return fallback ?? immediate
}
