import { createClient } from '@supabase/supabase-js'
import { registerWelcomeEmailRoute } from './email/welcomeRoute.js'
import {
  getMediaBridgeWelcomeKey,
  getResendApiKey,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from './email/env.js'

/**
 * Mount Resend email routes on the Media Bridge (welcome, pairing reminder, pin-changed, etc.).
 */
export function registerBridgeEmailRoutes(app) {
  const url = getSupabaseUrl()
  const anon = getSupabaseAnonKey()
  const service = getSupabaseServiceRoleKey()
  const welcomeKey = getMediaBridgeWelcomeKey()

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

  const resendOk = Boolean(getResendApiKey())
  const serviceOk = Boolean(supabaseServiceClient)
  const authOk = Boolean(supabaseAuthClient)
  if (!resendOk || !serviceOk) {
    console.error(
      '[bridge] email routes PARTIAL — pin-reset/pairing will return 503 until configured: ' +
        `RESEND_API_KEY=${resendOk ? 'ok' : 'MISSING'} ` +
        `SUPABASE_SERVICE_ROLE_KEY=${serviceOk ? 'ok' : 'MISSING'} ` +
        `SUPABASE_URL+ANON=${authOk ? 'ok' : 'MISSING'}`
    )
  } else {
    console.log('[bridge] email routes ready (Resend + Supabase service role)')
  }

  console.log('[bridge] email routes: /api/email/welcome, /pairing-reminder, /pin, /pin-reset-request, /pin-changed')
}
