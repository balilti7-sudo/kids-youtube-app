import { Resend } from 'resend'
import { getResendApiKey } from './env.js'

let client = null

export function getResendClient() {
  const key = getResendApiKey()
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}
