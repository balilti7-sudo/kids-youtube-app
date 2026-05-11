import { useSyncExternalStore } from 'react'
import { getSavedChildAccessToken } from '../lib/childDevice'

function subscribe(onStoreChange: () => void) {
  const fn = () => onStoreChange()
  window.addEventListener('storage', fn)
  window.addEventListener('safetube-kid-token-changed', fn as EventListener)
  return () => {
    window.removeEventListener('storage', fn)
    window.removeEventListener('safetube-kid-token-changed', fn as EventListener)
  }
}

function getSnapshot() {
  return typeof window !== 'undefined' && Boolean(getSavedChildAccessToken())
}

export function useKidDeviceTokenPresent() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
