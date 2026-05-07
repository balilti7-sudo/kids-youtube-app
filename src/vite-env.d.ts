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
  /** When `"true"`, CleanPlayer uses youtube-nocookie iframe with modestbranding=1&rel=0 instead of Media Bridge */
  readonly VITE_YOUTUBE_IFRAME_PLAYER?: string
  /** Must match `MEDIA_BRIDGE_WELCOME_KEY` on Render — allows POST /api/email/welcome and POST /api/email/pairing-reminder without JWT from the kid device */
  readonly VITE_MEDIA_BRIDGE_WELCOME_KEY?: string
  /** WhatsApp support — E.164 digits only, e.g. 972552577999 */
  readonly VITE_WHATSAPP_PHONE_E164?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
