import { getResendClient } from './resendClient.js'
import { getResendFrom, getResendReplyTo, getPublicLogoUrl } from './config.js'

/**
 * @param {{ to: string; displayName?: string | null; rows: Array<{ name: string; pairing_code: string }> }} opts
 */
export async function sendPairingReminderEmail({ to, displayName, rows }) {
  const resend = getResendClient()
  if (!resend) {
    throw new Error('RESEND_API_KEY is not configured')
  }
  const from = getResendFrom()
  const replyTo = getResendReplyTo()
  const name = (displayName || '').trim()
  const greeting = name ? `שלום ${name},` : 'שלום,'
  const logoUrl = getPublicLogoUrl()

  const listHtml =
    rows.length === 0
      ? `<p style="margin:12px 0 0 0;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;color:#334155;font-size:14px;">
  כרגע אין במערכת קוד צימוד פעיל (ממתין לצימוד). היכנסו ללוח הבקרה, צרו מכשיר חדש או רעננו קוד — ואז נסו שוב במסך הילד.
</p>`
      : `<ul style="margin:12px 0 0 0;padding:0;list-style:none;">
  ${rows
    .map(
      (r) => `<li style="margin:0 0 10px 0;padding:12px 14px;border:1px solid #fdba74;border-radius:10px;background:#fff7ed;color:#7c2d12;">
    <span style="display:block;font-size:13px;color:#9a3412;">${escapeHtml(r.name)}</span>
    <span style="display:block;font-size:20px;font-weight:700;letter-spacing:0.15em;margin-top:4px;" dir="ltr">${escapeHtml(r.pairing_code)}</span>
  </li>`
    )
    .join('')}
</ul>`

  const listText =
    rows.length === 0
      ? 'כרגע אין קוד צימוד פעיל. צרו מכשיר חדש או רעננו קוד בלוח הבקרה.'
      : rows.map((r) => `- ${r.name}: ${r.pairing_code}`).join('\n')

  const html = `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8" /></head>
<body style="margin:0;font-family:system-ui,sans-serif;line-height:1.6;color:#1e293b;background:#fff5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:16px;padding:0;overflow:hidden;box-shadow:0 12px 32px rgba(127,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#FF0000,#b30000);padding:20px;color:#ffffff;text-align:center;">
      <img src="${logoUrl}" alt="SafeTube" width="260" height="80" style="max-width:85%;width:260px;height:auto;display:block;margin:0 auto 12px;border:0;">
      <p style="margin:0;font-size:17px;font-weight:700;line-height:1.35;">תזכורת קוד צימוד</p>
    </div>
    <div style="padding:22px;">
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">ביקשתם לשלוח שוב את קודי הצימוד (6 ספרות) לצימוד מכשירי ילדים. הנה הקודים הפעילים כרגע:</p>
      ${listHtml}
      <p style="margin:16px 0 0 0;color:#475569;font-size:14px;">
        אם לא ביקשתם — התעלמו ממייל זה או פנו לתמיכה.
      </p>
      <p style="margin:20px 0 0 0;color:#64748b;font-size:13px;">בברכה,<br/>צוות SafeTube</p>
    </div>
  </div>
</body>
</html>`.trim()

  const text = `${greeting}

ביקשתם לשלוח שוב את קודי הצימוד ל-SafeTube.

${listText}

בברכה,
צוות SafeTube`

  const payload = {
    from,
    to: [to],
    subject: 'קוד צימוד SafeTube (תזכורת)',
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

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
