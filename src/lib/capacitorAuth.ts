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
import { AppLauncher } from '@capacitor/app-launcher'
import { Browser } from '@capacitor/browser'
import { toast } from 'sonner'
import { supabase } from './supabase'
import { setSkipParentalManagementGateOnce } from './parentalGateSkipOnce'
import {
  allowParentalControlBrowserBypass,
  clearParentalControlBrowserBypass,
} from './parentalControlNative'

export const NATIVE_OAUTH_REDIRECT = 'app.safetube.kids://auth-callback'

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Opens a URL outside the WebView. Prefers a Chrome Custom Tab; if the device has no
 * custom-tabs-capable browser reachable ("Unable to display URL"), falls back to a plain
 * ACTION_VIEW launch of the default browser.
 */
async function openInSystemBrowser(url: string): Promise<void> {
  // Site-filter must not kill Google OAuth Custom Tabs / the system browser mid-login.
  await allowParentalControlBrowserBypass(3 * 60 * 1000)
  try {
    await Browser.open({ url })
    return
  } catch (err) {
    console.warn('[capacitorAuth] Browser.open failed, falling back to AppLauncher', err)
  }
  const { completed } = await AppLauncher.openUrl({ url })
  if (!completed) {
    void clearParentalControlBrowserBypass()
    throw new Error('לא נמצא דפדפן פעיל במכשיר. הפעילו דפדפן (למשל Chrome) ונסו שוב.')
  }
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
  try {
    await openInSystemBrowser(data.url)
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) }
  }
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

/** Parse query params from custom-scheme deep links (`app.safetube.kids://host?a=b`). */
function paramsFromDeepLink(url: string): URLSearchParams {
  try {
    return new URL(url).searchParams
  } catch {
    /* some WebViews reject custom schemes in `new URL` — fall back to manual parse */
  }
  const q = url.indexOf('?')
  return new URLSearchParams(q >= 0 ? url.slice(q + 1).split('#')[0] : '')
}

function humanizeOAuthError(raw: string | null | undefined): string {
  const msg = String(raw || '').trim()
  if (!msg) return 'התחברות עם Google נכשלה.'
  // GoTrue truncates the Google auth code into this message when Client Secret / redirect is wrong.
  if (/unable to exchange external code/i.test(msg)) {
    return 'Google ב-Supabase לא מוגדר נכון (Client Secret). עדכנו את ה-Secret ב-Supabase ושמרו.'
  }
  return msg
}

async function completeOAuthCallback(url: string): Promise<void> {
  void clearParentalControlBrowserBypass()
  // Best effort — Browser.close() is a no-op/unsupported on some Android versions.
  try {
    await Browser.close()
  } catch {
    /* ignore */
  }

  const params = paramsFromDeepLink(url)
  const oauthError = params.get('error_description') || params.get('error')
  const code = params.get('code')
  if (!code) {
    console.error('[capacitorAuth] OAuth callback without code', { url, oauthError })
    toast.error(humanizeOAuthError(oauthError))
    return
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    console.error('[capacitorAuth] exchangeCodeForSession failed', error)
    toast.error(humanizeOAuthError(error.message))
    return
  }

  // The session is now persisted in localStorage. A clean reload lets the normal boot flow
  // (session restore → profile fetch → routing) take over — same as the web /auth/callback.
  setSkipParentalManagementGateOnce()
  window.location.assign('/')
}
