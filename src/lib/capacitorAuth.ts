/**
 * Google OAuth for the native (Capacitor) app.
 *
 * Google refuses OAuth inside embedded WebViews ("403: disallowed_useragent"), and the
 * in-app origin (https://localhost) is not a valid place for Supabase to redirect back to.
 * So on native we:
 *   1. ask Supabase for the OAuth URL without navigating (skipBrowserRedirect),
 *   2. open it in the SYSTEM browser (Chrome Custom Tab) — which Google allows,
 *   3. have Supabase redirect back into the app via the app.safetube.kids:// deep link,
 *   4. exchange the auth code for a session inside the WebView (the PKCE code_verifier
 *      was stored in the WebView's localStorage in step 1, so the exchange must happen here).
 *
 * The deep link is registered in AndroidManifest.xml, and the redirect URL must be listed in
 * Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.
 */
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { toast } from 'sonner'
import { supabase } from './supabase'
import { setSkipParentalManagementGateOnce } from './parentalGateSkipOnce'

export const NATIVE_OAUTH_REDIRECT = 'app.safetube.kids://auth-callback'

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/** Starts Google sign-in from inside the native app. Resolves once the system browser opens. */
export async function signInWithGoogleNative(): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: NATIVE_OAUTH_REDIRECT,
      skipBrowserRedirect: true,
    },
  })
  if (error) return { error: new Error(error.message) }
  if (!data?.url) return { error: new Error('Supabase returned no OAuth URL') }
  await Browser.open({ url: data.url })
  return { error: null }
}

/** Call once at startup (native only): completes the OAuth round-trip when the deep link fires. */
export function initCapacitorAuthDeepLinks(): void {
  if (!isNativeApp()) return

  void App.addListener('appUrlOpen', ({ url }) => {
    if (!url || !url.startsWith(NATIVE_OAUTH_REDIRECT)) return
    void completeOAuthCallback(url)
  })
}

async function completeOAuthCallback(url: string): Promise<void> {
  // Best effort — Browser.close() is a no-op/unsupported on some Android versions.
  try {
    await Browser.close()
  } catch {
    /* ignore */
  }

  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return
  }

  const oauthError = params.get('error_description') || params.get('error')
  const code = params.get('code')
  if (!code) {
    console.error('[capacitorAuth] OAuth callback without code', { url, oauthError })
    toast.error(oauthError || 'התחברות עם Google נכשלה.')
    return
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('[capacitorAuth] exchangeCodeForSession failed', error)
    toast.error(error.message || 'התחברות עם Google נכשלה.')
    return
  }

  // The session is now persisted in localStorage. A clean reload lets the normal boot flow
  // (session restore → profile fetch → routing) take over — same as the web /auth/callback.
  setSkipParentalManagementGateOnce()
  window.location.assign('/')
}
