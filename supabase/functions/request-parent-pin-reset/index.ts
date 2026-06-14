// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')?.trim() || ''
const RESEND_FROM = Deno.env.get('RESEND_FROM')?.trim() || 'SafeTube <support@safetube.co.il>'
const RESEND_REPLY_TO = Deno.env.get('RESEND_REPLY_TO')?.trim() || ''
const PIN_RESET_SECRET =
  Deno.env.get('PIN_RESET_REQUEST_SECRET')?.trim() ||
  Deno.env.get('MEDIA_BRIDGE_WELCOME_KEY')?.trim() ||
  Deno.env.get('WELCOME_EMAIL_WEBHOOK_SECRET')?.trim() ||
  ''

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')?.trim() || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || ''

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_EMAIL_LOGO_URL = 'https://safetube.co.il/logo.png'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-media-bridge-welcome-key, x-pin-reset-request-secret',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function logoAbsoluteUrl(): string {
  const explicit = Deno.env.get('EMAIL_LOGO_URL')?.trim()
  if (explicit) return explicit
  const site = (Deno.env.get('PUBLIC_SITE_URL') ?? '').trim().replace(/\/+$/, '')
  if (site) return `${site}/logo.png`
  return DEFAULT_EMAIL_LOGO_URL
}

function generateParentPinDigits(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += String(Math.floor(Math.random() * 10))
  return s
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().toLowerCase()
}

function requestSecretOk(req: Request): boolean {
  if (!PIN_RESET_SECRET) return false
  const header =
    req.headers.get('x-pin-reset-request-secret')?.trim() ||
    req.headers.get('x-media-bridge-welcome-key')?.trim() ||
    ''
  return header.length > 0 && header === PIN_RESET_SECRET
}

async function sendResendEmail(payload: Record<string, unknown>) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const bodyText = await resp.text()
  if (!resp.ok) {
    throw new Error(`resend_failed: ${bodyText}`)
  }
}

function buildPinResetNoticeHtml(name: string, logoUrl: string) {
  return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:system-ui,sans-serif;line-height:1.6;color:#1e293b;background:#fff5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:16px;padding:0;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#FF0000,#b30000);padding:20px;color:#ffffff;text-align:center;">
      <img src="${logoUrl}" alt="SafeTube" width="260" height="80" style="max-width:85%;width:260px;height:auto;display:block;margin:0 auto 8px;border:0;">
      <p style="margin:0;font-size:16px;font-weight:700;">איפוס קוד הורה — SafeTube</p>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;">שלום ${name},</p>
      <p style="margin:0 0 12px;">ביקשתם לאפס את <strong>קוד ההורה</strong>. נוצר עבורכם קוד חדש — הוא מופיע במייל נפרד.</p>
      <p style="margin:0 0 12px;">לאחר הכניסה: <strong>הגדרות → קוד PIN לנעילת הורים</strong> לבחירת קוד אישי.</p>
      <p style="margin:0;font-size:0.9rem;color:#64748b;">אם לא ביקשתם איפוס — התעלמו ממייל זה.</p>
    </div>
  </div>
</body>
</html>`.trim()
}

function buildPinEmailHtml(pin: string, logoUrl: string) {
  const safePin = String(pin || '').replace(/\s+/g, '').trim()
  return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:system-ui,sans-serif;line-height:1.6;color:#1e293b;background:#fff5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:16px;padding:0;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#FF0000,#b30000);padding:20px;color:#ffffff;text-align:center;">
      <img src="${logoUrl}" alt="SafeTube" width="260" height="80" style="max-width:85%;width:260px;height:auto;display:block;margin:0 auto 8px;border:0;">
      <p style="margin:0;font-size:16px;font-weight:700;">קוד PIN לניהול SafeTube</p>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;">שלום רב,</p>
      <p style="margin:0 0 12px;">הנה קוד ה-PIN החדש שלכם: <strong>${safePin}</strong></p>
      <p style="margin:0;">שמרו עליו במקום בטוח ואל תשתפו אותו עם הילדים.</p>
    </div>
  </div>
</body>
</html>`.trim()
}

function bearerToken(req: Request): string {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' })
  }

  if (!RESEND_API_KEY) {
    return json(503, { ok: false, error: 'missing_resend_api_key' })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(503, { ok: false, error: 'service_database_not_configured' })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let body: { email?: string } = {}
  try {
    body = (await req.json()) as { email?: string }
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  let profile: { id: string; email: string | null; full_name: string | null; parent_pin: string | null } | null =
    null

  const token = bearerToken(req)
  if (token) {
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData.user?.id) {
      return json(401, { ok: false, error: 'unauthorized' })
    }

    const { data: jwtProfile, error: jwtErr } = await admin
      .from('profiles')
      .select('id, email, full_name, parent_pin')
      .eq('id', userData.user.id)
      .maybeSingle()

    if (jwtErr) {
      console.error('[request-parent-pin-reset] jwt profile', jwtErr.message)
      return json(502, { ok: false, error: 'update_failed' })
    }

    if (!jwtProfile?.id) {
      return json(404, { ok: false, error: 'profile_not_found' })
    }

    const requestedEmail = normalizeEmail(body.email)
    const accountEmail = normalizeEmail(userData.user.email || jwtProfile.email || '')
    if (requestedEmail && accountEmail && requestedEmail !== accountEmail) {
      return json(403, { ok: false, error: 'email_mismatch' })
    }

    profile = jwtProfile
  } else {
    if (!requestSecretOk(req)) {
      return json(401, { ok: false, error: 'unauthorized' })
    }

    const email = normalizeEmail(body.email)
    if (!email || !EMAIL_RE.test(email)) {
      return json(400, { ok: false, error: 'invalid_email' })
    }

    const { data: emailProfile, error: qErr } = await admin
      .from('profiles')
      .select('id, email, full_name, parent_pin')
      .ilike('email', email)
      .maybeSingle()

    if (qErr) {
      console.error('[request-parent-pin-reset] profile', qErr.message)
      return json(200, { ok: true, sent: false })
    }

    if (!emailProfile?.id) {
      return json(200, { ok: true, sent: false })
    }

    profile = emailProfile
  }

  if (!profile?.id) {
    return json(200, { ok: true, sent: false })
  }

  const email = normalizeEmail(profile.email || '')
  if (!email || !EMAIL_RE.test(email)) {
    return json(502, { ok: false, error: 'update_failed' })
  }

  const newPin = generateParentPinDigits()
  const { error: upErr } = await admin.from('profiles').update({ parent_pin: newPin }).eq('id', profile.id)

  if (upErr) {
    console.error('[request-parent-pin-reset] update', upErr.message)
    return json(502, { ok: false, error: 'update_failed' })
  }

  const logoUrl = logoAbsoluteUrl()
  const displayName = String(profile.full_name || '').trim() || 'הורה יקר'

  try {
    const basePayload: Record<string, unknown> = { from: RESEND_FROM, to: [email] }
    if (RESEND_REPLY_TO) basePayload.reply_to = RESEND_REPLY_TO

    await sendResendEmail({
      ...basePayload,
      subject: 'איפוס קוד הורה — SafeTube',
      html: buildPinResetNoticeHtml(displayName, logoUrl),
      text: `שלום ${displayName},\n\nביקשתם איפוס קוד הורה ב-SafeTube. הקוד החדש נשלח במייל נפרד.\n`,
    })

    await sendResendEmail({
      ...basePayload,
      subject: 'קוד ה-PIN שלך לניהול SafeTube 🔑',
      html: buildPinEmailHtml(newPin, logoUrl),
      text: `שלום רב,\n\nקוד ה-PIN החדש שלכם: ${newPin}\n`,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[request-parent-pin-reset] resend', msg)
    return json(502, { ok: false, error: 'email_send_failed' })
  }

  return json(200, { ok: true, sent: true })
})
