import { getStreamApiBaseUrl } from './streamApi'

export type ParentPinResetResult =
  | { ok: true; sent: true }
  | { ok: true; sent: false }
  | { ok: false; error: string; status?: number }

/**
 * Request a new parent management PIN by email (server generates PIN; never shown in gate UI).
 */
export async function requestParentPinResetEmail(emailRaw: string): Promise<ParentPinResetResult> {
  const email = emailRaw.trim().toLowerCase()
  const base = getStreamApiBaseUrl()
  const welcomeKey = (import.meta.env.VITE_MEDIA_BRIDGE_WELCOME_KEY as string | undefined)?.trim()

  const headers: Record<string, string> = {
    accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (welcomeKey) headers['X-Media-Bridge-Welcome-Key'] = welcomeKey

  if (!welcomeKey) {
    return { ok: false, error: 'שירות האימייל לא מוגדר במכשיר זה.' }
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/email/pin-reset-request`, {
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

  if (body.sent === true) return { ok: true, sent: true }
  return { ok: true, sent: false }
}
