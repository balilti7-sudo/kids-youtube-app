import { timingSafeEqual } from 'node:crypto'
import { sendWelcomeEmail } from './sendWelcome.js'
import { sendPinEmail } from './sendPin.js'
import { sendPairingReminderEmail } from './sendPairingReminder.js'
import { sendPinChangedEmail } from './sendPinChanged.js'
import { sendPinResetEmail } from './sendPinReset.js'
import { getResendApiKey } from './env.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** @type {Map<string, { count: number; windowStart: number }>} */
const rateByIp = new Map()
/** @type {Map<string, number>} normalized email -> expiresAt */
const dedupeWelcome = new Map()
/** @type {Map<string, number>} normalized email -> expiresAt — pairing reminder (stricter) */
const dedupePairingReminder = new Map()
/** @type {Map<string, number>} normalized email -> expiresAt — PIN changed notification */
const dedupePinChanged = new Map()
const dedupePinReset = new Map()
const PIN_CHANGED_DEDUPE_MS = 2 * 60 * 1000
const PIN_RESET_DEDUPE_MS = 5 * 60 * 1000

const WELCOME_RATE_WINDOW_MS = 60 * 60 * 1000
const WELCOME_RATE_MAX = 20
const WELCOME_DEDUPE_MS = 24 * 60 * 60 * 1000

/** @type {Map<string, { count: number; windowStart: number }>} */
const pairingRateByIp = new Map()
const PAIRING_REMINDER_RATE_WINDOW_MS = 60 * 60 * 1000
const PAIRING_REMINDER_RATE_MAX = 12
const PAIRING_REMINDER_DEDUPE_MS = 15 * 60 * 1000

function pruneDedupe() {
  const now = Date.now()
  for (const [k, exp] of dedupeWelcome) {
    if (now > exp) dedupeWelcome.delete(k)
  }
  for (const [k, exp] of dedupePairingReminder) {
    if (now > exp) dedupePairingReminder.delete(k)
  }
  for (const [k, exp] of dedupePinChanged) {
    if (now > exp) dedupePinChanged.delete(k)
  }
  for (const [k, exp] of dedupePinReset) {
    if (now > exp) dedupePinReset.delete(k)
  }
}

function generateParentPinDigits() {
  let s = ''
  for (let i = 0; i < 6; i++) s += String(Math.floor(Math.random() * 10))
  return s
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

function rateLimitPairingReminderOk(ip) {
  const now = Date.now()
  const key = ip || 'unknown'
  let rec = pairingRateByIp.get(key)
  if (!rec || now - rec.windowStart > PAIRING_REMINDER_RATE_WINDOW_MS) {
    rec = { count: 0, windowStart: now }
  }
  rec.count += 1
  pairingRateByIp.set(key, rec)
  return rec.count <= PAIRING_REMINDER_RATE_MAX
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
 * @param {{
 *   supabaseAuthClient: import('@supabase/supabase-js').SupabaseClient | null
 *   supabaseServiceClient: import('@supabase/supabase-js').SupabaseClient | null
 *   welcomeKey: string
 * }} ctx
 */
export function registerWelcomeEmailRoute(app, { supabaseAuthClient, supabaseServiceClient, welcomeKey }) {
  app.post('/api/email/welcome', async (req, res) => {
    const apiKey = getResendApiKey()
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

  app.post('/api/email/pairing-reminder', async (req, res) => {
    const apiKey = getResendApiKey()
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' })
    }
    if (!supabaseServiceClient) {
      return res.status(503).json({ ok: false, error: 'Pairing reminder not configured (missing service role)' })
    }

    const email = normalizeEmail(req.body?.email)
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' })
    }

    const ip = getClientIp(req)
    if (!rateLimitPairingReminderOk(ip)) {
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
    if (dedupePairingReminder.has(email) && dedupePairingReminder.get(email) > now) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent_recently' })
    }

    try {
      const { data: profile, error: profileError } = await supabaseServiceClient
        .from('profiles')
        .select('id, full_name')
        .ilike('email', email)
        .maybeSingle()

      if (profileError) {
        const msg = profileError.message || String(profileError)
        console.error('[email/pairing-reminder] profile', msg)
        return res.status(502).json({ ok: false, error: msg })
      }
      if (!profile?.id) {
        dedupePairingReminder.set(email, now + PAIRING_REMINDER_DEDUPE_MS)
        return res.status(200).json({ ok: true, sent: false })
      }

      const { data: devices, error: devError } = await supabaseServiceClient
        .from('devices')
        .select('name, pairing_code')
        .eq('user_id', profile.id)
        .not('pairing_code', 'is', null)

      if (devError) {
        const msg = devError.message || String(devError)
        console.error('[email/pairing-reminder] devices query', msg)
        return res.status(502).json({ ok: false, error: msg })
      }

      const rows = (devices ?? [])
        .map((d) => ({
          name: String(d.name || 'מכשיר').trim() || 'מכשיר',
          pairing_code: String(d.pairing_code || '').replace(/\s+/g, '').trim(),
        }))
        .filter((d) => /^\d{6}$/.test(d.pairing_code))

      await sendPairingReminderEmail({
        to: email,
        displayName: profile.full_name,
        rows,
      })
      dedupePairingReminder.set(email, now + PAIRING_REMINDER_DEDUPE_MS)
      return res.status(200).json({ ok: true, sent: true, deviceCount: rows.length })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email/pairing-reminder]', msg)
      return res.status(502).json({ ok: false, error: msg })
    }
  })

  app.post('/api/email/pin', async (req, res) => {
    const apiKey = getResendApiKey()
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

  /**
   * Forgot parent PIN: generate a new PIN server-side and email it (gate UI never collects a new PIN).
   * Requires MEDIA_BRIDGE welcome key (same as pairing reminder). Always returns ok to avoid email enumeration.
   */
  app.post('/api/email/pin-reset-request', async (req, res) => {
    const apiKey = getResendApiKey()
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' })
    }

    const ip = getClientIp(req)
    if (!rateLimitOk(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests' })
    }

    if (!supabaseServiceClient) {
      return res.status(503).json({ ok: false, error: 'Service database not configured' })
    }

    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const headerKey = String(req.get('x-media-bridge-welcome-key') || '').trim()
    const welcomeOk = welcomeKey && safeEqualKey(headerKey, welcomeKey)

    let email = normalizeEmail(req.body?.email)
    let profile = null

    try {
      if (bearer && supabaseAuthClient) {
        const { data: userData, error: userError } = await supabaseAuthClient.auth.getUser(bearer)
        if (userError || !userData.user?.id) {
          return res.status(401).json({ ok: false, error: 'Unauthorized' })
        }

        const accountEmail = normalizeEmail(userData.user.email)
        if (email && accountEmail && email !== accountEmail) {
          return res.status(403).json({ ok: false, error: 'Email mismatch' })
        }

        const { data: jwtProfile, error: jwtErr } = await supabaseServiceClient
          .from('profiles')
          .select('id, email, full_name, parent_pin')
          .eq('id', userData.user.id)
          .maybeSingle()

        if (jwtErr) {
          console.error('[email/pin-reset-request] jwt profile', jwtErr.message)
          return res.status(502).json({ ok: false, error: 'Update failed' })
        }

        if (!jwtProfile?.id) {
          return res.status(404).json({ ok: false, error: 'Profile not found' })
        }

        profile = jwtProfile
        email = normalizeEmail(jwtProfile.email || accountEmail)
      } else {
        if (!welcomeOk) {
          return res.status(401).json({ ok: false, error: 'Unauthorized' })
        }

        if (!email || !EMAIL_RE.test(email)) {
          return res.status(400).json({ ok: false, error: 'Invalid email' })
        }

        const { data: emailProfile, error: qErr } = await supabaseServiceClient
          .from('profiles')
          .select('id, email, full_name, parent_pin')
          .ilike('email', email)
          .maybeSingle()

        if (qErr) {
          console.error('[email/pin-reset-request] profile', qErr.message)
          return res.status(200).json({ ok: true, sent: false })
        }

        if (!emailProfile?.id) {
          return res.status(200).json({ ok: true, sent: false })
        }

        profile = emailProfile
      }

      if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ ok: false, error: 'Invalid email' })
      }

      pruneDedupe()
      const now = Date.now()
      if (dedupePinReset.has(email) && dedupePinReset.get(email) > now) {
        return res.status(200).json({ ok: true, sent: false, message: 'deduped' })
      }

      if (!profile?.id) {
        return res.status(200).json({ ok: true, sent: false })
      }

      const newPin = generateParentPinDigits()
      const { error: upErr } = await supabaseServiceClient
        .from('profiles')
        .update({ parent_pin: newPin })
        .eq('id', profile.id)

      if (upErr) {
        console.error('[email/pin-reset-request] update', upErr.message)
        return res.status(502).json({ ok: false, error: 'Update failed' })
      }

      await sendPinResetEmail({ to: email, displayName: profile.full_name })
      await sendPinEmail({ to: email, pin: newPin })
      dedupePinReset.set(email, now + PIN_RESET_DEDUPE_MS)
      return res.status(200).json({ ok: true, sent: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email/pin-reset-request]', msg)
      return res.status(502).json({ ok: false, error: msg })
    }
  })

  /** PIN change confirmation — authenticated parent only; never includes PIN in email. */
  app.post('/api/email/pin-changed', async (req, res) => {
    const apiKey = getResendApiKey()
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'RESEND_API_KEY not configured' })
    }

    const ip = getClientIp(req)
    if (!rateLimitOk(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests' })
    }

    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!bearer || !supabaseAuthClient) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const { data: userData, error: userError } = await supabaseAuthClient.auth.getUser(bearer)
    if (userError || !userData.user?.email) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const email = normalizeEmail(userData.user.email)
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email' })
    }

    pruneDedupe()
    const now = Date.now()
    if (dedupePinChanged.has(email) && dedupePinChanged.get(email) > now) {
      return res.status(200).json({ ok: true, skipped: true })
    }

    let displayName = userData.user.user_metadata?.full_name || null
    if (supabaseServiceClient) {
      const { data: profile } = await supabaseServiceClient
        .from('profiles')
        .select('full_name')
        .eq('id', userData.user.id)
        .maybeSingle()
      if (profile?.full_name) displayName = profile.full_name
    }

    try {
      await sendPinChangedEmail({ to: email, displayName })
      dedupePinChanged.set(email, now + PIN_CHANGED_DEDUPE_MS)
      return res.status(200).json({ ok: true, sent: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[email/pin-changed]', msg)
      return res.status(502).json({ ok: false, error: msg })
    }
  })
}
