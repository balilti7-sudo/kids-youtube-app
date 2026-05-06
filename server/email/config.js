/**
 * Central place for Resend "from" / branding. When you verify a domain in Resend,
 * set `RESEND_FROM` on Render to e.g. `SafeTube <hello@yourdomain.com>` — no code changes.
 */
export function getResendFrom() {
  const raw = (process.env.RESEND_FROM || '').trim()
  if (raw) return raw
  return 'SafeTube <support@safetube.co.il>'
}

export function getResendReplyTo() {
  const v = (process.env.RESEND_REPLY_TO || '').trim()
  return v || undefined
}

/** Absolute URL to `logo.png` for HTML emails (`PUBLIC_SITE_URL` + `/logo.png`, or `EMAIL_LOGO_URL`). */
export function getPublicLogoUrl() {
  const explicit = (process.env.EMAIL_LOGO_URL || '').trim()
  if (explicit) return explicit
  const site = (process.env.PUBLIC_SITE_URL || process.env.APP_SITE_URL || '').trim().replace(/\/+$/, '')
  if (site) return `${site}/logo.png`
  return 'https://safetube.co.il/logo.png'
}
