/**
 * Secure local storage for secrets (child access token, short-lived encrypted blobs).
 * - Android (Capacitor): EncryptedSharedPreferences via SecureStorage plugin (Keystore).
 * - Web: AES-GCM with a non-extractable CryptoKey in IndexedDB (best-effort; WebView storage
 *   is still weaker than Keystore — never store long-lived parent PINs here).
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

interface SecureStoragePlugin {
  set(options: { key: string; value: string }): Promise<void>
  get(options: { key: string }): Promise<{ value: string | null }>
  remove(options: { key: string }): Promise<void>
}

const NativeSecureStorage = registerPlugin<SecureStoragePlugin>('SecureStorage')

const IDB_NAME = 'safetube_secure_v1'
const IDB_STORE = 'keys'
const WEB_KEY_ID = 'aes-gcm-v1'
const WEB_PREFIX = 'safetube_enc:'

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
}

async function idbGet(key: string): Promise<CryptoKey | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'))
  })
}

async function idbPut(key: string, value: CryptoKey): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'))
  })
}

async function getOrCreateWebKey(): Promise<CryptoKey> {
  const existing = await idbGet(WEB_KEY_ID)
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await idbPut(WEB_KEY_ID, key)
  return key
}

function b64Encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s)
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function webEncrypt(plain: string): Promise<string> {
  const key = await getOrCreateWebKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain)
  )
  const packed = new Uint8Array(iv.length + cipher.byteLength)
  packed.set(iv, 0)
  packed.set(new Uint8Array(cipher), iv.length)
  return WEB_PREFIX + b64Encode(packed.buffer)
}

async function webDecrypt(blob: string): Promise<string | null> {
  if (!blob.startsWith(WEB_PREFIX)) return null
  try {
    const key = await getOrCreateWebKey()
    const packed = b64Decode(blob.slice(WEB_PREFIX.length))
    const iv = packed.slice(0, 12)
    const data = packed.slice(12)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/** Persist a secret. On Android uses EncryptedSharedPreferences; on web AES-GCM + localStorage. */
export async function secureSet(key: string, value: string): Promise<void> {
  if (isNativeAndroid()) {
    await NativeSecureStorage.set({ key, value })
    return
  }
  if (typeof window === 'undefined') return
  try {
    const enc = await webEncrypt(value)
    window.localStorage.setItem(`safetube_secure_${key}`, enc)
  } catch {
    /* ignore quota / crypto failures */
  }
}

export async function secureGet(key: string): Promise<string | null> {
  if (isNativeAndroid()) {
    const { value } = await NativeSecureStorage.get({ key })
    return value ?? null
  }
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`safetube_secure_${key}`)
    if (!raw) return null
    if (raw.startsWith(WEB_PREFIX)) return webDecrypt(raw)
    // Legacy plaintext migration path
    return raw
  } catch {
    return null
  }
}

export async function secureRemove(key: string): Promise<void> {
  if (isNativeAndroid()) {
    await NativeSecureStorage.remove({ key })
    return
  }
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(`safetube_secure_${key}`)
  } catch {
    /* ignore */
  }
}
