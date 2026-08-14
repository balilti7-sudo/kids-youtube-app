import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getRemoteConfig,
  fetchAndActivate,
  getValue,
  type RemoteConfig,
} from 'firebase/remote-config'

export const TESTER_RC_KEYS = {
  enabled: 'tester_access_enabled',
  code: 'tester_access_code',
} as const

type FirebaseWebConfig = {
  apiKey: string
  authDomain?: string
  projectId: string
  storageBucket?: string
  messagingSenderId?: string
  appId: string
}

function readFirebaseConfig(): FirebaseWebConfig | null {
  const apiKey = String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim()
  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
  const appId = String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim()
  if (!apiKey || !projectId || !appId) return null
  return {
    apiKey,
    authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim() || undefined,
    projectId,
    storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim() || undefined,
    messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim() || undefined,
    appId,
  }
}

let app: FirebaseApp | null = null
let remoteConfig: RemoteConfig | null = null

export function isFirebaseConfigured(): boolean {
  return readFirebaseConfig() != null
}

export function getFirebaseApp(): FirebaseApp | null {
  const cfg = readFirebaseConfig()
  if (!cfg) return null
  if (app) return app
  app = getApps().length > 0 ? getApps()[0]! : initializeApp(cfg)
  return app
}

export function getTesterRemoteConfig(): RemoteConfig | null {
  const firebaseApp = getFirebaseApp()
  if (!firebaseApp) return null
  if (remoteConfig) return remoteConfig
  remoteConfig = getRemoteConfig(firebaseApp)
  remoteConfig.settings = {
    minimumFetchIntervalMillis: import.meta.env.DEV ? 0 : 60_000,
    fetchTimeoutMillis: 20_000,
  }
  // Fail-closed defaults until the first successful fetch from the Firebase console.
  remoteConfig.defaultConfig = {
    [TESTER_RC_KEYS.enabled]: 'true',
    [TESTER_RC_KEYS.code]: String(import.meta.env.VITE_TESTER_ACCESS_CODE_DEFAULT || 'SafeTubeQA').trim(),
  }
  return remoteConfig
}

export type TesterRemotePolicy = {
  accessEnabled: boolean
  accessCode: string
  fetched: boolean
}

export async function fetchTesterRemotePolicy(): Promise<TesterRemotePolicy> {
  const rc = getTesterRemoteConfig()
  if (!rc) {
    return {
      accessEnabled: false,
      accessCode: '',
      fetched: false,
    }
  }

  let fetched = false
  try {
    await fetchAndActivate(rc)
    fetched = true
  } catch (e) {
    console.warn('[testerGate] Remote Config fetch failed; using defaults/cache', e)
  }

  const enabledRaw = getValue(rc, TESTER_RC_KEYS.enabled).asString().trim().toLowerCase()
  const accessEnabled = !(enabledRaw === 'false' || enabledRaw === '0' || enabledRaw === 'off')
  const accessCode = getValue(rc, TESTER_RC_KEYS.code).asString().trim()

  return { accessEnabled, accessCode, fetched }
}
