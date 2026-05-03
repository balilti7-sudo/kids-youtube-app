import { Resend } from 'resend'

let client = null

export function getResendClient() {
  const key = (process.env.RESEND_API_KEY || '').trim()
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}
