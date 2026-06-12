import { isSupabaseConfigured, supabase } from './supabase'
import { getStreamApiBaseUrl } from './streamApi'

export type ParentPinResetResult =
  | { ok: true; sent: true }
  | { ok: true; sent: false }
  | { ok: false; error: string; status?: number }

function mapPinResetError(raw: string): string {
  const err = raw.trim()
  if (/missing_resend_api_key|RESEND_API_KEY not configured/i.test(err)) {
    return 'שליחת המייל לא מוגדרת בשרת. פנו לתמיכה או נסו שוב מאוחר יותר.'
  }
  if (/unauthorized|Unauthorized|invalid.*secret/i.test(err)) {
    return 'שירות שחזור הקוד לא מוגדר באפליקציה (מפתח אבטחה חסר).'
  }
  if (/service_database_not_configured|Service database not configured/i.test(err)) {
    return 'שירות השחזור לא זמין כרגע. נסו שוב מאוחר יותר.'
  }
  if (/invalid_email|Invalid email/i.test(err)) {
    return 'נא להזין כתובת אימייל תקינה.'
  }
  if (/update_failed|email_send_failed|resend_failed/i.test(err)) {
    return 'לא הצלחנו לשלוח את המייל. נסו שוב בעוד מספר דקות.'
  }
  return err || 'שגיאה בשליחת המייל'
}

function welcomeKeyHeaders(welcomeKey: string): Record<string, string> {
  return {
    'X-Media-Bridge-Welcome-Key': welcomeKey,
    'X-Pin-Reset-Request-Secret': welcomeKey,
  }
}

function parseResetBody(body: unknown): { ok: boolean; sent?: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_response' }
  const record = body as Record<string, unknown>
  if (record.ok === false) {
    return { ok: false, error: typeof record.error === 'string' ? record.error : 'request_failed' }
  }
  return { ok: true, sent: record.sent === true }
}

async function requestViaSupabaseFunction(
  email: string,
  welcomeKey: string
): Promise<ParentPinResetResult | null> {
  if (!isSupabaseConfigured) return null

  const { data, error } = await supabase.functions.invoke('request-parent-pin-reset', {
    body: { email },
    headers: welcomeKeyHeaders(welcomeKey),
  })

  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as Record<string, unknown>
        if (payload.ok === false && typeof payload.error === 'string') {
          return { ok: false, error: mapPinResetError(payload.error), status: ctx.status }
        }
      } catch {
        /* ignore */
      }
    }
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      return null
    }
    return { ok: false, error: mapPinResetError(error.message), status: 500 }
  }

  const parsed = parseResetBody(data)
  if (!parsed.ok) {
    return { ok: false, error: mapPinResetError(parsed.error ?? 'request_failed') }
  }
  return parsed.sent ? { ok: true, sent: true } : { ok: true, sent: false }
}

async function requestViaMediaBridge(email: string, welcomeKey: string): Promise<ParentPinResetResult> {
  const base = getStreamApiBaseUrl()
  let res: Response
  try {
    res = await fetch(`${base}/api/email/pin-reset-request`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        ...welcomeKeyHeaders(welcomeKey),
      },
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
    return { ok: false, error: mapPinResetError(err), status: res.status }
  }

  if (body.sent === true) return { ok: true, sent: true }
  return { ok: true, sent: false }
}

/**
 * Request a new parent management PIN by email (server generates PIN; never shown in gate UI).
 * Prefers Supabase Edge Function (Resend secrets on Supabase); falls back to Media Bridge.
 */
export async function requestParentPinResetEmail(emailRaw: string): Promise<ParentPinResetResult> {
  const email = emailRaw.trim().toLowerCase()
  const welcomeKey = (import.meta.env.VITE_MEDIA_BRIDGE_WELCOME_KEY as string | undefined)?.trim()

  if (!welcomeKey) {
    return { ok: false, error: 'שירות שחזור הקוד לא מוגדר באפליקציה.' }
  }

  const viaSupabase = await requestViaSupabaseFunction(email, welcomeKey)
  if (viaSupabase) return viaSupabase

  return requestViaMediaBridge(email, welcomeKey)
}
