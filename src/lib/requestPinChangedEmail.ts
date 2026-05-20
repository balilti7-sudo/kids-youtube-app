import { getStreamApiBaseUrl } from './streamApi'

/**
 * Fire-and-forget: notify parent that PIN was changed (no PIN in email body).
 * Requires Supabase session access_token (Bearer) — same bridge auth as profile PIN change.
 */
export function requestPinChangedEmail(accessToken: string | null | undefined): void {
  const token = (accessToken || '').trim()
  if (!token) {
    if (import.meta.env.DEV) {
      console.info('[pinChangedEmail] skipped: no access token')
    }
    return
  }

  const base = getStreamApiBaseUrl()
  void fetch(`${base}/api/email/pin-changed`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  }).catch((err) => {
    console.warn('[pinChangedEmail] request failed:', err)
  })
}
