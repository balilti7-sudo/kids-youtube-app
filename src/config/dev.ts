/**
 * When true: skip login + onboarding; open the app on Home (dashboard) without a session.
 * Set to false before production or when testing auth again.
 */
export const BYPASS_AUTH = false

/**
 * When true and there is no session: use VITE_DEV_DEVICE_OWNER_ID or a stable UUID in localStorage
 * as devices.user_id so you can test inserts without logging in.
 * If Supabase still enforces FK to profiles(id), set VITE_DEV_DEVICE_OWNER_ID to a real profile UUID from your DB.
 */
export const USE_DEV_DUMMY_DEVICE_OWNER = true
