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
