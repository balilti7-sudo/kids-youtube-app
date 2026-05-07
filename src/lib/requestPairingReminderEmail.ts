import { getStreamApiBaseUrl } from './streamApi'

export type PairingReminderResult =
  | { ok: true; sent: true; deviceCount: number }
  | { ok: true; sent: false }
  | { ok: true; skipped: true }
  | { ok: false; error: string; status?: number }

/**
 * Resend active 6-digit pairing codes to the parent email (Media Bridge + Resend).
 * Same shared secret as welcome email — kid device has no Supabase session.
 */
export async function requestPairingReminderEmail(emailRaw: string): Promise<PairingReminderResult> {
  const email = emailRaw.trim().toLowerCase()
  const base = getStreamApiBaseUrl()
  const welcomeKey = (import.meta.env.VITE_MEDIA_BRIDGE_WELCOME_KEY as string | undefined)?.trim()

  const headers: Record<string, string> = {
    accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (welcomeKey) headers['X-Media-Bridge-Welcome-Key'] = welcomeKey

  if (!welcomeKey) {
    return { ok: false, error: 'השירות לא מוגדר במכשיר זה (חסר מפתח Media Bridge).' }
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/email/pairing-reminder`, {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify({ email }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const err = typeof body.error === 'string' ? body.error : `שגיאה ${res.status}`
    return { ok: false, error: err, status: res.status }
  }

  if (body.skipped === true) {
    return { ok: true, skipped: true }
  }
  if (body.sent === true && typeof body.deviceCount === 'number') {
    return { ok: true, sent: true, deviceCount: body.deviceCount }
  }
  if (body.sent === false) {
    return { ok: true, sent: false }
  }
  return { ok: true, sent: true, deviceCount: 0 }
}
