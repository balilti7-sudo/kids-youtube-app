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

/**
 * Absolute URL to the deployed `public/logo.png` for HTML emails.
 * Priority: `EMAIL_LOGO_URL` (full URL to the PNG) → `PUBLIC_SITE_URL` + `/logo.png` → production fallback.
 * Local dev: most clients cannot load localhost; use a tunnel URL or point `EMAIL_LOGO_URL` at your live site.
 */
export function getPublicLogoUrl() {
  const explicit = (process.env.EMAIL_LOGO_URL || '').trim()
  if (explicit) return explicit
  const site = (process.env.PUBLIC_SITE_URL || process.env.APP_SITE_URL || '').trim().replace(/\/+$/, '')
  if (site) return `${site}/logo.png`
  return 'https://safetube.co.il/logo.png'
}
