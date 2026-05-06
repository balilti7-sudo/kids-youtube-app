import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo } from './config.js'

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

  const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #1e293b;">
  <p>${greeting}</p>
  <p>איזה כיף שהצטרפתם למשפחת <strong>SafeTube</strong>.</p>
  <p>מהיום, אתם יכולים להיות רגועים כשהילדים צופים ביוטיוב.</p>
  <p>המערכת שלנו מסננת עבורכם את התכנים ומוודאת שהם רואים רק מה שמתאים להם.</p>
  <p>אנחנו כאן לכל שאלה, צוות SafeTube.</p>
  <p style="margin-top: 2rem; font-size: 0.9rem; color: #64748b;">בברכה,<br />צוות SafeTube</p>
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
