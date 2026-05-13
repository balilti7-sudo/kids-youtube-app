import type { User } from '@supabase/supabase-js'

/**
 * Accounts without an `email` identity (e.g. Google-only) cannot use `signInWithPassword`
 * for re-auth; use email OTP / magic link instead.
 */
export function userRequiresEmailOtpForParentPinForgot(user: User | null | undefined): boolean {
  if (!user?.email) return false
  const identities = user.identities ?? []
  if (identities.length === 0) {
    const p = user.app_metadata?.provider
    return p === 'google' || p === 'apple' || p === 'github' || p === 'facebook' || p === 'azure'
  }
  const providers = new Set(identities.map((i) => i.provider))
  return !providers.has('email')
}
