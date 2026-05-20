/**
 * One-shot global auth-state tracer.
 *
 * Logs every Supabase auth transition to the console with a high-contrast
 * prefix so we can spot the EXACT event/session sequence around a sign-in
 * (SIGNED_IN, INITIAL_SESSION, USER_UPDATED, TOKEN_REFRESHED, SIGNED_OUT, ...).
 * Side-effect free — does not mutate any state.
 *
 * Wired from main.tsx. Safe to call in production; volume is tiny.
 */
import { supabase } from './supabase'

const STYLE = 'background:#7c3aed;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600'
const STYLE_WARN = 'background:#dc2626;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600'

function shortSession(s: { user?: { id?: string; email?: string | null } | null; expires_at?: number | null } | null) {
  if (!s) return null
  return {
    userId: s.user?.id ?? null,
    email: s.user?.email ?? null,
    expiresAt: s.expires_at ? new Date(s.expires_at * 1000).toISOString() : null,
  }
}

let installed = false

export function installAuthDiagnostics() {
  if (installed) return
  installed = true

  console.info('%c[auth-diag] installing global onAuthStateChange listener', STYLE)

  supabase.auth.onAuthStateChange((event, session) => {
    const stamp = new Date().toISOString()
    const isWarn = event === 'SIGNED_OUT' || String(event) === 'USER_DELETED'
    console.info(
      `%c[auth-diag] ${stamp} event=${event}`,
      isWarn ? STYLE_WARN : STYLE,
      shortSession(session),
    )
  })

  // Also dump a snapshot of any persisted sb-* / supabase token storage keys
  // at startup — useful when a stuck/corrupted token is causing the bounce.
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (!k) continue
      if (k.includes('supabase') || /^sb-.*-auth-token$/.test(k)) {
        keys.push(k)
      }
    }
    console.info('%c[auth-diag] supabase localStorage keys at startup', STYLE, keys)
  } catch {
    /* ignore */
  }
}
