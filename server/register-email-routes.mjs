import { createClient } from '@supabase/supabase-js'
import { registerWelcomeEmailRoute } from './email/welcomeRoute.js'

/**
 * Mount Resend email routes on the Media Bridge (welcome, pairing reminder, pin-changed, etc.).
 */
export function registerBridgeEmailRoutes(app) {
  const url = (process.env.SUPABASE_URL || '').trim()
  const anon = (process.env.SUPABASE_ANON_KEY || '').trim()
  const service = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const welcomeKey = (process.env.MEDIA_BRIDGE_WELCOME_KEY || '').trim()

  let supabaseAuthClient = null
  let supabaseServiceClient = null

  if (url && anon) {
    supabaseAuthClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  if (url && service) {
    supabaseServiceClient = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  registerWelcomeEmailRoute(app, {
    supabaseAuthClient,
    supabaseServiceClient,
    welcomeKey,
  })

  console.log('[bridge] email routes: /api/email/welcome, /pairing-reminder, /pin, /pin-reset-request, /pin-changed')
}
