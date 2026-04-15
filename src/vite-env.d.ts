/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** YouTube Data API v3 — חשוף בדפדפן; הגבילו מפתח לפי Referrer ב-Google Cloud */
  readonly VITE_YOUTUBE_API_KEY?: string
  /** PIN for parent-only device disconnect action in kid mode */
  readonly VITE_PARENT_UNLOCK_PIN?: string
  /** אופציונלי: UUID קיים ב-profiles כש-FK פעיל ואין התחברות */
  readonly VITE_DEV_DEVICE_OWNER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
