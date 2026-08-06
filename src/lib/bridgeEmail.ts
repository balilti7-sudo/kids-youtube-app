import { getStreamApiBaseUrl } from './streamApi'

export type BridgeEmailResult = {
  ok: boolean
  /** True when the request was intentionally not sent (missing auth). */
  skipped?: boolean
  error?: string
}

async function postBridgeEmail(
  path: string,
  body: Record<string, unknown>,
  opts: { accessToken?: string | null; requireAuth?: boolean; logTag: string }
): Promise<BridgeEmailResult> {
  const base = getStreamApiBaseUrl()
  const accessToken = (opts.accessToken || '').trim() || null

  const headers: Record<string, string> = {
    accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (accessToken) headers.authorization = `Bearer ${accessToken}`

  // Never ship MEDIA_BRIDGE_WELCOME_KEY in the client bundle — Bearer session only.
  if (!accessToken) {
    if (import.meta.env.DEV) {
      console.info(`[${opts.logTag}] skipped: no access token`)
    }
    return {
      ok: false,
      skipped: true,
      error: 'יש להתחבר מחדש כדי לשלוח מייל',
    }
  }

  if (opts.requireAuth && !accessToken) {
    return { ok: false, skipped: true, error: 'יש להתחבר מחדש כדי לשלוח מייל' }
  }

  try {
    const { capacitorAwareFetch } = await import('./capacitorHttpFetch')
    const res = await capacitorAwareFetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let detail = `שגיאת מייל (${res.status})`
      try {
        const json = (await res.json()) as { error?: string; detail?: string; message?: string }
        detail = json.detail || json.error || json.message || detail
      } catch {
        /* ignore */
      }
      console.warn(`[${opts.logTag}] bridge returned`, res.status)
      return { ok: false, error: detail }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[${opts.logTag}] request failed`)
    return { ok: false, error: message }
  }
}

/** Parent PIN reminder email via Media Bridge + Resend. */
export async function requestPinEmail(opts: {
  email: string
  pin: string
  accessToken: string | null
}): Promise<BridgeEmailResult> {
  const email = opts.email.trim()
  const pin = opts.pin.replace(/\D/g, '')
  if (!email || !pin) {
    return { ok: false, skipped: true, error: 'חסר אימייל או קוד PIN לשליחה' }
  }
  return postBridgeEmail('/api/email/pin', { email, pin }, {
    accessToken: opts.accessToken,
    logTag: 'pinEmail',
  })
}

/** Welcome email via Media Bridge + Resend. */
export async function requestWelcomeEmail(opts: {
  email: string
  accessToken: string | null
}): Promise<BridgeEmailResult> {
  const email = opts.email.trim()
  if (!email) return { ok: false, skipped: true, error: 'חסר אימייל' }
  return postBridgeEmail('/api/email/welcome', { email }, {
    accessToken: opts.accessToken,
    logTag: 'welcomeEmail',
  })
}

/** Notify parent that PIN was changed (no PIN in body). Requires Bearer session. */
export async function requestPinChangedEmail(
  accessToken: string | null | undefined
): Promise<BridgeEmailResult> {
  return postBridgeEmail(
    '/api/email/pin-changed',
    {},
    { accessToken, requireAuth: true, logTag: 'pinChangedEmail' }
  )
}
