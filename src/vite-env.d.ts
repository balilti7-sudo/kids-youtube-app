/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** YouTube Data API v3 — חשוף בדפדפן; הגבילו מפתח לפי Referrer ב-Google Cloud */
  readonly VITE_YOUTUBE_API_KEY?: string
  /** PIN for parent-only device disconnect action in kid mode */
  readonly VITE_PARENT_UNLOCK_PIN?: string
  /** PIN for parent-only channel management controls */
  readonly VITE_PARENT_MANAGEMENT_PIN?: string
  /** אופציונלי: UUID קיים ב-profiles כש-FK פעיל ואין התחברות */
  readonly VITE_DEV_DEVICE_OWNER_ID?: string
  /** Media Bridge base URL (no trailing slash), e.g. http://localhost:8787 */
  readonly VITE_STREAM_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
