const ACTIVE_PLAYLIST_ID_KEY = 'safetube_active_playlist_id'

export const ACTIVE_PLAYLIST_CHANGED_EVENT = 'safetube-active-playlist-changed'

export function getSavedActivePlaylistId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_PLAYLIST_ID_KEY)?.trim()
    return id || null
  } catch {
    return null
  }
}

export function saveActivePlaylistId(playlistId: string) {
  try {
    localStorage.setItem(ACTIVE_PLAYLIST_ID_KEY, playlistId)
    window.dispatchEvent(
      new CustomEvent(ACTIVE_PLAYLIST_CHANGED_EVENT, { detail: { playlistId } })
    )
  } catch {
    /* ignore storage errors */
  }
}

export function clearActivePlaylistIdIfMatches(playlistId: string) {
  try {
    if (getSavedActivePlaylistId() === playlistId) {
      localStorage.removeItem(ACTIVE_PLAYLIST_ID_KEY)
      window.dispatchEvent(
        new CustomEvent(ACTIVE_PLAYLIST_CHANGED_EVENT, { detail: { playlistId: null } })
      )
    }
  } catch {
    /* ignore storage errors */
  }
}
