import { createClient } from '@supabase/supabase-js'
import { capacitorAwareFetch } from './capacitorHttpFetch'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && key)

const isValidHttpUrl = (value?: string) => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const hasValidUrl = isValidHttpUrl(url)

export const supabase = createClient(
  hasValidUrl ? url! : 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  {
    // Capacitor Android WebView blocks cross-origin fetch (CORS) from https://localhost.
    // Route Supabase Auth + Edge Functions through native HTTP.
    global: {
      fetch: capacitorAwareFetch,
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      /** SPA / OAuth עם redirect — מהימן יותר מ-implicit בסביבות מודרניות */
      flowType: 'pkce',
      /** Email confirmation / magic-link redirects can carry tokens in the URL — pick up session without an extra login step. */
      detectSessionInUrl: true,
    },
  }
)
