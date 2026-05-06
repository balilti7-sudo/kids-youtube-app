// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

type WelcomePayload = {
  profile_id?: string
  email?: string
  full_name?: string | null
  parent_pin?: string | null
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')?.trim() || ''
const RESEND_FROM = Deno.env.get('RESEND_FROM')?.trim() || 'SafeTube <onboarding@resend.dev>'
const RESEND_REPLY_TO = Deno.env.get('RESEND_REPLY_TO')?.trim() || ''
const WEBHOOK_SECRET = Deno.env.get('WELCOME_EMAIL_WEBHOOK_SECRET')?.trim() || ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-welcome-email-secret',
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function normalizePin(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, '').trim()
}

function buildHtml(name: string, pin: string) {
  const greeting = name ? `שלום ${name},` : 'שלום,'
  const pinBlock = pin
    ? `
  <div style="margin:16px 0;padding:12px 14px;border:1px solid #fdba74;border-radius:10px;background:#fff7ed;color:#7c2d12;">
    <p style="margin:0 0 6px 0;font-size:14px;">תזכורת:</p>
    <p style="margin:0;font-size:16px;font-weight:700;">Your Parent PIN is: ${pin}</p>
  </div>`
    : `
  <div style="margin:16px 0;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155;">
    <p style="margin:0;font-size:14px;">טרם הוגדר קוד הורה. ניתן להגדירו במסך Set Parent PIN באפליקציה.</p>
  </div>`

  return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.65;color:#1e293b;background:#f1f5f9;padding:24px;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #dbeafe;border-radius:16px;padding:0;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
    <div style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:16px 20px;color:#ffffff;">
      <p style="margin:0;font-size:13px;letter-spacing:0.06em;text-transform:uppercase;opacity:.95;">SafeTube</p>
      <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.3;">ברוכים הבאים ל-SafeTube</h1>
    </div>
    <div style="padding:22px 22px 24px 22px;">
    <p style="margin:0 0 12px 0;">${greeting}</p>
    <p style="margin:0 0 12px 0;">
      החשבון שלכם נוצר בהצלחה. עכשיו אפשר להגדיר חוויית צפייה בטוחה לילדים עם שליטה מלאה של ההורה.
    </p>
    ${pinBlock}
    <p style="margin:16px 0 0 0;color:#475569;font-size:14px;">
      אם לא אתם יצרתם את החשבון, אנא פנו לתמיכה בהקדם.
    </p>
    <p style="margin:20px 0 0 0;color:#64748b;font-size:13px;">בברכה,<br/>צוות SafeTube</p>
    </div>
  </div>
</body>
</html>`.trim()
}

function buildText(name: string, pin: string) {
  const greeting = name ? `שלום ${name},` : 'שלום,'
  const pinLine = pin ? `\nYour Parent PIN is: ${pin}\n` : '\nטרם הוגדר קוד הורה. ניתן להגדיר אותו במסך Set Parent PIN.\n'
  return `${greeting}

ברוכים הבאים ל-SafeTube.
החשבון שלכם נוצר בהצלחה.
${pinLine}
בברכה,
צוות SafeTube`
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

  if (WEBHOOK_SECRET) {
    const incoming = req.headers.get('x-welcome-email-secret')?.trim() || ''
    if (incoming !== WEBHOOK_SECRET) {
      return json(401, { ok: false, error: 'invalid_webhook_secret' })
    }
  }

  let payload: WelcomePayload
  try {
    payload = (await req.json()) as WelcomePayload
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  const email = String(payload.email || '').trim().toLowerCase()
  if (!email) {
    return json(400, { ok: false, error: 'missing_email' })
  }

  const displayName = String(payload.full_name || '').trim()
  const pin = normalizePin(payload.parent_pin)

  const resendPayload: Record<string, unknown> = {
    from: RESEND_FROM,
    to: [email],
    subject: 'ברוכים הבאים ל-SafeTube',
    html: buildHtml(displayName, pin),
    text: buildText(displayName, pin),
  }
  if (RESEND_REPLY_TO) {
    resendPayload.reply_to = RESEND_REPLY_TO
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendPayload),
  })

  const bodyText = await resp.text()
  if (!resp.ok) {
    return json(502, { ok: false, error: 'resend_failed', detail: bodyText })
  }

  return json(200, { ok: true })
})
