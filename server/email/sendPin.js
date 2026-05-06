import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo } from './config.js'

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

  const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #1e293b;">
  <p>שלום רב,</p>
  <p>לבקשתך, הנה קוד ה-PIN האישי שלך לכניסה לאזור ההורים ב-SafeTube: <strong>${safePin}</strong>.</p>
  <p>שמרו עליו במקום בטוח ואל תשתפו אותו עם הילדים.</p>
  <p style="margin-top: 2rem; font-size: 0.9rem; color: #64748b;">בברכה,<br />צוות SafeTube</p>
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
