import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo, getPublicLogoUrl } from './config.js'

/**
 * @param {{ to: string; pin: string }} opts
 */
export async function sendPinEmail({ to, pin }) {
  const resend = getResendClient()
  if (!resend) {
    throw new Error('RESEND_API_KEY is not configured')
  }
  const from = getResendFrom()
  const replyTo = getResendReplyTo()

  const safePin = String(pin || '').replace(/\s+/g, '').trim()
  const logoUrl = getPublicLogoUrl()

  const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:system-ui,sans-serif;line-height:1.6;color:#1e293b;background:#fff5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:16px;padding:0;overflow:hidden;box-shadow:0 12px 32px rgba(127,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#FF0000,#b30000);padding:20px;color:#ffffff;text-align:center;">
      <img src="${logoUrl}" alt="SafeTube" width="260" height="80" style="max-width:85%;width:260px;height:auto;display:block;margin:0 auto 8px;border:0;">
      <p style="margin:0;font-size:16px;font-weight:700;">קוד PIN לניהול SafeTube</p>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;">שלום רב,</p>
      <p style="margin:0 0 12px;">לבקשתך, הנה קוד ה-PIN האישי שלך לכניסה לאזור ההורים ב-SafeTube: <strong>${safePin}</strong>.</p>
      <p style="margin:0;">שמרו עליו במקום בטוח ואל תשתפו אותו עם הילדים.</p>
      <p style="margin-top:28px;margin-bottom:0;font-size:0.9rem;color:#64748b;">בברכה,<br />צוות SafeTube</p>
    </div>
  </div>
</body>
</html>`.trim()

  const text = `שלום רב,

לבקשתך, הנה קוד ה-PIN האישי שלך לכניסה לאזור ההורים ב-SafeTube: ${safePin}.
שמרו עליו במקום בטוח ואל תשתפו אותו עם הילדים.

בברכה,
צוות SafeTube`

  const payload = {
    from,
    to: [to],
    subject: 'קוד ה-PIN שלך לניהול SafeTube 🔑',
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
