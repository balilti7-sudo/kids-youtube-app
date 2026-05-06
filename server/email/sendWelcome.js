import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo, getPublicLogoUrl } from './config.js'

/**
 * @param {{ to: string; displayName?: string | null }} opts
 */
export async function sendWelcomeEmail({ to, displayName }) {
  const resend = getResendClient()
  if (!resend) {
    throw new Error('RESEND_API_KEY is not configured')
  }
  const from = getResendFrom()
  const replyTo = getResendReplyTo()
  const name = (displayName || '').trim()
  const greeting = name ? `שלום ${name},` : 'שלום,'
  const logoUrl = getPublicLogoUrl()

  const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:system-ui,sans-serif;line-height:1.6;color:#1e293b;background:#fff5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:16px;padding:0;overflow:hidden;box-shadow:0 12px 32px rgba(127,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#FF0000,#b30000);padding:20px;color:#ffffff;text-align:center;">
      <img src="${logoUrl}" alt="SafeTube" width="260" height="80" style="max-width:85%;width:260px;height:auto;display:block;margin:0 auto 12px;border:0;">
      <p style="margin:0;font-size:17px;font-weight:700;line-height:1.35;">ברוכים הבאים ל-SafeTube</p>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">איזה כיף שהצטרפתם למשפחת <strong>SafeTube</strong>.</p>
      <p style="margin:0 0 12px;">מהיום, אתם יכולים להיות רגועים כשהילדים צופים ביוטיוב.</p>
      <p style="margin:0 0 12px;">המערכת שלנו מסננת עבורכם את התכנים ומוודאת שהם רואים רק מה שמתאים להם.</p>
      <p style="margin:0;">אנחנו כאן לכל שאלה, צוות SafeTube.</p>
      <p style="margin-top:28px;margin-bottom:0;font-size:0.9rem;color:#64748b;">בברכה,<br />צוות SafeTube</p>
    </div>
  </div>
</body>
</html>`.trim()

  const text = `${greeting}

איזה כיף שהצטרפתם למשפחת SafeTube.
מהיום, אתם יכולים להיות רגועים כשהילדים צופים ביוטיוב.
המערכת שלנו מסננת עבורכם את התכנים ומוודאת שהם רואים רק מה שמתאים להם.
אנחנו כאן לכל שאלה, צוות SafeTube.

בברכה,
צוות SafeTube`

  const payload = {
    from,
    to: [to],
    subject: 'ברוכים הבאים ל-SafeTube 🛡️ הילדים שלכם בידיים בטוחות',
    html,
    text,
  }
  if (replyTo) payload.replyTo = replyTo

  const { data, error } = await resend.emails.send(payload)
  if (error) {
    throw new Error(typeof error.message === 'string' ? error.message : JSON.stringify(error))
  }
  return data
}
