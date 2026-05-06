import { getStreamApiBaseUrl } from './streamApi'

/**
 * Fire-and-forget parent PIN reminder email via Media Bridge + Resend route.
 */
export function requestPinEmail(opts: { email: string; pin: string; accessToken: string | null }): void {
  const { email, pin, accessToken } = opts
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
      console.info('[pinEmail] skipped: no access token and no VITE_MEDIA_BRIDGE_WELCOME_KEY')
    }
    return
  }

  void fetch(`${base}/api/email/pin`, {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: JSON.stringify({ email, pin }),
  }).catch((err) => {
    console.warn('[pinEmail] request failed:', err)
  })
}
