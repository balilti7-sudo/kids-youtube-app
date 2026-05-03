/**
 * Central place for Resend "from" / branding. When you verify a domain in Resend,
 * set `RESEND_FROM` on Render to e.g. `SafeTube <hello@yourdomain.com>` — no code changes.
 */
export function getResendFrom() {
  const raw = (process.env.RESEND_FROM || '').trim()
  if (raw) return raw
  return 'onboarding@resend.dev'
}

export function getResendReplyTo() {
  const v = (process.env.RESEND_REPLY_TO || '').trim()
  return v || undefined
}
