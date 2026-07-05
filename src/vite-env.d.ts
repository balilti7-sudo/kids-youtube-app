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
  /**
   * Media Bridge origin (no path). Production: bridge HTTPS URL only.
   * Local dev: leave unset or use `vite-proxy` — see VITE_STREAM_API_USE_VITE_PROXY.
   */
  readonly VITE_STREAM_API_BASE?: string
  /** Local dev: `"true"` forces Vite proxy (`/api` → 127.0.0.1:8787) even if BASE is set. */
  readonly VITE_STREAM_API_USE_VITE_PROXY?: string
  /** Optional override for vite.config.ts proxy target (default http://127.0.0.1:8787). */
  readonly VITE_MEDIA_BRIDGE_PROXY_TARGET?: string
  /** Max ms to wait for Media Bridge `GET /api/stream/:videoId` (default 180000). */
  readonly VITE_STREAM_INFO_TIMEOUT_MS?: string
  /** Per status-poll HTTP request timeout (ms). Default 45000. */
  readonly VITE_STREAM_STATUS_POLL_TIMEOUT_MS?: string
  /**
   * When `"true"`, the browser resolves YouTube streams via InnerTube (youtubei.js)
   * instead of the Render ingest worker / yt-dlp. Bridge must set USE_CLIENT_STREAM_RESOLVE=1.
   */
  readonly VITE_CLIENT_STREAM_RESOLVE?: string
  /** When `"true"`, CleanPlayer uses youtube-nocookie iframe with modestbranding=1&rel=0 instead of Media Bridge */
  readonly VITE_YOUTUBE_IFRAME_PLAYER?: string
  /**
   * Shared secret for forgot-PIN / pairing emails.
   * Set the same value in Supabase Edge Function secrets as `PIN_RESET_REQUEST_SECRET` or `MEDIA_BRIDGE_WELCOME_KEY`.
   */
  readonly VITE_MEDIA_BRIDGE_WELCOME_KEY?: string
  /** WhatsApp support — E.164 digits only, e.g. 972552577999 */
  readonly VITE_WHATSAPP_PHONE_E164?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
