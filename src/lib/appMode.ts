const KEY = 'safetube_app_mode'

export type SafeTubeAppMode = 'kid' | 'parent'

export function getSavedAppMode(): SafeTubeAppMode | null {
  try {
    const v = window.localStorage.getItem(KEY)
    if (v === 'kid' || v === 'parent') return v
    return null
  } catch {
    return null
  }
}

export function setAppModeKid() {
  try {
    window.localStorage.setItem(KEY, 'kid')
  } catch {
    /* ignore */
  }
}

export function setAppModeParent() {
  try {
    window.localStorage.setItem(KEY, 'parent')
  } catch {
    /* ignore */
  }
}

export function clearAppMode() {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
