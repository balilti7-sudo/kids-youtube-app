/**
 * Resolve secrets from env — supports legacy/alternate variable names on Render & self-hosted bridge.
 */

export function getResendApiKey() {
  const names = ['RESEND_API_KEY', 'RESEND_KEY', 'RESEND_SECRET']
  for (const name of names) {
    const value = (process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

export function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
}

export function getSupabaseAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim()
}

export function getSupabaseServiceRoleKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    ''
  ).trim()
}

export function getMediaBridgeWelcomeKey() {
  return (
    process.env.MEDIA_BRIDGE_WELCOME_KEY ||
    process.env.PIN_RESET_REQUEST_SECRET ||
    process.env.WELCOME_EMAIL_WEBHOOK_SECRET ||
    ''
  ).trim()
}
