export const BEDTIME_GOODNIGHT_PREVIEW_EVENT = 'safetube-bedtime-goodnight-preview'

const SEEN_KEY_PREFIX = 'safetube_bedtime_goodnight_seen_'

export function requestBedtimeGoodnightPreview(deviceId: string) {
  try {
    window.dispatchEvent(
      new CustomEvent(BEDTIME_GOODNIGHT_PREVIEW_EVENT, { detail: { deviceId } })
    )
  } catch {
    /* ignore */
  }
}

export function goodnightSeenStorageKey(deviceId: string, routineDate: string) {
  return `${SEEN_KEY_PREFIX}${deviceId}_${routineDate}`
}

export function hasSeenBedtimeGoodnight(deviceId: string, routineDate: string): boolean {
  try {
    return localStorage.getItem(goodnightSeenStorageKey(deviceId, routineDate)) === '1'
  } catch {
    return false
  }
}

export function markBedtimeGoodnightSeen(deviceId: string, routineDate: string) {
  try {
    localStorage.setItem(goodnightSeenStorageKey(deviceId, routineDate), '1')
  } catch {
    /* ignore */
  }
}
