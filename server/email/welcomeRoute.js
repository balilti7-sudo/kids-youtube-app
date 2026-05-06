import { timingSafeEqual } from 'node:crypto'
import { sendWelcomeEmail } from './sendWelcome.js'
import { sendPinEmail } from './sendPin.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** @type {Map<string, { count: number; windowStart: number }>} */
const rateByIp = new Map()
/** @type {Map<string, number>} normalized email -> expiresAt */
const dedupeWelcome = new Map()

const WELCOME_RATE_WINDOW_MS = 60 * 60 * 1000
const WELCOME_RATE_MAX = 20
const WELCOME_DEDUPE_MS = 24 * 60 * 60 * 1000

function pruneDedupe() {
  const now = Date.now()
  for (const [k, exp] of dedupeWelcome) {
    if (now > exp) dedupeWelcome.delete(k)
  }
}

function rateLimitOk(ip) {
  const now = Date.now()
  const key = ip || 'unknown'
  let rec = rateByIp.get(key)
  if (!rec || now - rec.windowStart > WELCOME_RATE_WINDOW_MS) {
    rec = { count: 0, windowStart: now }
  }
  rec.count += 1
  rateByIp.set(key, rec)
  return rec.count <= WELCOME_RATE_MAX
}

function getClientIp(req) {
  const xf = req.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim() || 'unknown'
  return req.socket?.remoteAddress || 'unknown'
}

function safeEqualKey(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function normalizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return ''
  return raw.trim().toLowerCase()
}

/**
 * @param {import('express').Application} app
 * @param {{ supabaseAuthClient: import('@supabase/supabase-js').SupabaseClient | null; welcomeKey: string }} ctx
 */
export function registerWelcomeEmailRoute(app, { supabaseAuthClient, welcomeKey }) {
  app.post('/api/email/welcome', async (req, res) => {
    const apiKey = (process.env.RESEND_API_KEY || '').trim()
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' })
    }

    const email = normalizeEmail(req.body?.email)
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' })
    }

    const ip = getClientIp(req)
    if (!rateLimitOk(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests' })
    }

    const headerKey = String(req.get('x-media-bridge-welcome-key') || '').trim()
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()

    let authorized = false
    if (welcomeKey && headerKey && safeEqualKey(headerKey, welcomeKey)) {
      authorized = true
    }
    if (!authorized && bearer && supabaseAuthClient) {
      const { data, error } = await supabaseAuthClient.auth.getUser(bearer)
      if (!error && data.user?.email && normalizeEmail(data.user.email) === email) {
        authorized = true
      }
    }

    if (!authorized) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    pruneDedupe()
    const now = Date.now()
    if (dedupeWelcome.has(email) && dedupeWelcome.get(email) > now) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent_recently' })
    }

    try {
      await sendWelcomeEmail({ to: email, displayName: null })
      dedupeWelcome.set(email, now + WELCOME_DEDUPE_MS)
      return res.status(200).json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email/welcome]', msg)
      return res.status(502).json({ ok: false, error: msg })
    }
  })

  app.post('/api/email/pin', async (req, res) => {
    const apiKey = (process.env.RESEND_API_KEY || '').trim()
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' })
    }

    const email = normalizeEmail(req.body?.email)
    const pin = String(req.body?.pin || '').replace(/\s+/g, '').trim()
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' })
    }
    if (!/^\d{4,}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: 'Invalid PIN' })
    }

    const ip = getClientIp(req)
    if (!rateLimitOk(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests' })
    }

    const headerKey = String(req.get('x-media-bridge-welcome-key') || '').trim()
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()

    let authorized = false
    if (welcomeKey && headerKey && safeEqualKey(headerKey, welcomeKey)) {
      authorized = true
    }
    if (!authorized && bearer && supabaseAuthClient) {
      const { data, error } = await supabaseAuthClient.auth.getUser(bearer)
      if (!error && data.user?.email && normalizeEmail(data.user.email) === email) {
        authorized = true
      }
    }

    if (!authorized) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    try {
      await sendPinEmail({ to: email, pin })
      return res.status(200).json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email/pin]', msg)
      return res.status(502).json({ ok: false, error: msg })
    }
  })
}
