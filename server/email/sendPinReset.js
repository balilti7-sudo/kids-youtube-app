import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo, getPublicLogoUrl } from './config.js'

/**
 * Parent forgot-PIN flow: email with new management PIN (never shown in the gate UI).
 * @param {{ to: string; displayName?: string | null }} opts
 */
export async function sendPinResetEmail({ to, displayName }) {
  const resend = getResendClient()
  if (!resend) {
    throw new Error('RESEND_API_KEY is not configured')
  }
  const from = getResendFrom()
  const replyTo = getResendReplyTo()
  const logoUrl = getPublicLogoUrl()
  const name = displayName?.trim() || 'הורה יקר'

  const html = `
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
      <p style="margin:0 0 12px;">ביקשתם לאפס את <strong>קוד ההורה</strong> לכניסה לאזור הניהול. נוצר עבורכם קוד חדש — הוא מופיע בהמשך המייל בלבד.</p>
      <p style="margin:0 0 12px;">לאחר הכניסה, מומלץ לעבור ל<strong>הגדרות → קוד PIN לנעילת הורים</strong> ולבחור קוד שתזכרו.</p>
      <p style="margin:0;font-size:0.9rem;color:#64748b;">אם לא ביקשתם איפוס — התעלמו ממייל זה או צרו קשר עם התמיכה.</p>
      <p style="margin-top:28px;margin-bottom:0;font-size:0.9rem;color:#64748b;">בברכה,<br />צוות SafeTube</p>
    </div>
  </div>
</body>
</html>`.trim()

  const text = `שלום ${name},

ביקשתם לאיפוס קוד ההורה ב-SafeTube. הקוד החדש נשלח במייל נפרד (או בהמשך הודעה זו לפי הגדרות המערכת).

לאחר הכניסה: הגדרות → קוד PIN לנעילת הורים — לבחירת קוד אישי.

בברכה,
צוות SafeTube`

  const payload = {
    from,
    to: [to],
    subject: 'איפוס קוד הורה — SafeTube',
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
