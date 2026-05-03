import { getStreamApiBaseUrl } from './streamApi'

/**
 * Fire-and-forget welcome email via Media Bridge + Resend.
 * Auth: either a fresh Supabase access token (when returned from signUp) or
 * `VITE_MEDIA_BRIDGE_WELCOME_KEY` matching `MEDIA_BRIDGE_WELCOME_KEY` on Render.
 */
export function requestWelcomeEmail(opts: { email: string; accessToken: string | null }): void {
  const { email, accessToken } = opts
  const base = getStreamApiBaseUrl()
  const welcomeKey = (import.meta.env.VITE_MEDIA_BRIDGE_WELCOME_KEY as string | undefined)?.trim()

  const headers: Record<string, string> = {
    accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  if (welcomeKey) headers['X-Media-Bridge-Welcome-Key'] = welcomeKey

  if (!accessToken && !welcomeKey) {
    if (import.meta.env.DEV) {
      console.info(
        '[welcomeEmail] skipped: no session from signUp and no VITE_MEDIA_BRIDGE_WELCOME_KEY — set key on Vercel + Render to send welcome without JWT'
      )
    }
    return
  }

  void fetch(`${base}/api/email/welcome`, {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: JSON.stringify({ email }),
  }).catch((err) => {
    console.warn('[welcomeEmail] request failed:', err)
  })
}
