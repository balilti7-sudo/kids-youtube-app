import { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

const AUTH_FAILURE_COUNT_KEY = 'safetube_auth_failure_count'
const AUTH_FAILURE_CLEAR_THRESHOLD = 3
const SESSION_PROFILE_STUCK_COUNT_KEY = 'safetube_session_profile_stuck_count'
/**
 * Bumped from 3 to 5 + we now require ~3s of grace time before incrementing,
 * because a successful sign-in produces one transient render where session is
 * set but profile is still null. Counting that render as a "stuck" iteration
 * was bouncing users out within a fraction of a second of logging in.
 */
const SESSION_PROFILE_STUCK_THRESHOLD = 5
const SESSION_PROFILE_STUCK_GRACE_MS = 3000

function clearCorruptedSupabaseTokenStorage() {
  try {
    const keysToDelete: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (!k) continue
      if (k.includes('supabase.auth.token') || /^sb-.*-auth-token$/.test(k)) {
        keysToDelete.push(k)
      }
    }
    keysToDelete.forEach((k) => window.localStorage.removeItem(k))
    if (keysToDelete.length > 0) {
      console.warn('[auth] cleared possibly corrupted Supabase auth token keys', keysToDelete)
    }
  } catch {
    /* ignore */
  }
}

function resetAuthFailureCounter() {
  try {
    window.sessionStorage.removeItem(AUTH_FAILURE_COUNT_KEY)
  } catch {
    /* ignore */
  }
}

function resetSessionProfileStuckCounter() {
  try {
    window.sessionStorage.removeItem(SESSION_PROFILE_STUCK_COUNT_KEY)
  } catch {
    /* ignore */
  }
}

function registerAuthFailureAndMaybeClearCorruptedToken() {
  try {
    const current = Number(window.sessionStorage.getItem(AUTH_FAILURE_COUNT_KEY) || '0')
    const next = Number.isFinite(current) ? current + 1 : 1
    window.sessionStorage.setItem(AUTH_FAILURE_COUNT_KEY, String(next))
    if (next >= AUTH_FAILURE_CLEAR_THRESHOLD) {
      clearCorruptedSupabaseTokenStorage()
      window.sessionStorage.removeItem(AUTH_FAILURE_COUNT_KEY)
    }
  } catch {
    /* ignore */
  }
}

function registerSessionProfileStuckAndShouldClear(): boolean {
  try {
    const current = Number(window.sessionStorage.getItem(SESSION_PROFILE_STUCK_COUNT_KEY) || '0')
    const next = Number.isFinite(current) ? current + 1 : 1
    window.sessionStorage.setItem(SESSION_PROFILE_STUCK_COUNT_KEY, String(next))
    return next >= SESSION_PROFILE_STUCK_THRESHOLD
  } catch {
    return false
  }
}

export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const profile = useAuthStore((s) => s.profile)
  const loading = useAuthStore((s) => s.loading)
  const profileLoading = useAuthStore((s) => s.profileLoading)
  const setSession = useAuthStore((s) => s.setSession)
  const setLoading = useAuthStore((s) => s.setLoading)
  const fetchProfile = useAuthStore((s) => s.fetchProfile)
  const signOut = useAuthStore((s) => s.signOut)
  const signOutClearEverything = useAuthStore((s) => s.signOutClearEverything)

  useEffect(() => {
    let mounted = true
    console.info('[useAuth] initial getSession() mount')

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (!mounted) {
          console.info('[useAuth] getSession resolved AFTER unmount — ignored')
          return
        }
        console.info('[useAuth] getSession resolved', {
          hasSession: Boolean(s),
          userId: s?.user?.id ?? null,
          email: s?.user?.email ?? null,
        })
        setSession(s)
        setLoading(false)
        if (s?.user) {
          resetAuthFailureCounter()
          resetSessionProfileStuckCounter()
          void useAuthStore.getState().fetchProfile()
        }
      })
      .catch((e) => {
        console.error('[useAuth] getSession FAILED — this would set session=null', e)
        registerAuthFailureAndMaybeClearCorruptedToken()
        if (!mounted) return
        setSession(null)
        setLoading(false)
      })

    return () => {
      console.info('[useAuth] cleanup — initial getSession effect (mounted=false)')
      mounted = false
    }
  }, [setSession, setLoading])

  useEffect(() => {
    if (user) void fetchProfile()
    else useAuthStore.setState({ profile: null, profileLoading: false })
  }, [user, fetchProfile])

  const sessionEstablishedAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (session && user) {
      if (sessionEstablishedAtRef.current === null) {
        sessionEstablishedAtRef.current = Date.now()
      }
    } else {
      sessionEstablishedAtRef.current = null
    }
  }, [session, user])

  useEffect(() => {
    if (!session || !user) {
      resetSessionProfileStuckCounter()
      return
    }
    if (loading || profileLoading) return
    if (profile) {
      resetSessionProfileStuckCounter()
      return
    }

    // Give the in-flight fetchProfile() a chance before counting this render as
    // a "stuck" iteration. Without this, the very first re-render after a
    // successful signIn (session set, profile not yet hydrated) was already
    // bumping the counter, and 3 consecutive bumps triggered an auto-signOut.
    const establishedAt = sessionEstablishedAtRef.current
    if (establishedAt !== null && Date.now() - establishedAt < SESSION_PROFILE_STUCK_GRACE_MS) {
      const wait = SESSION_PROFILE_STUCK_GRACE_MS - (Date.now() - establishedAt) + 50
      console.info('[useAuth] stuck-check within grace period — retrying fetchProfile in', wait, 'ms')
      const t = window.setTimeout(() => {
        void useAuthStore.getState().fetchProfile()
      }, wait)
      return () => window.clearTimeout(t)
    }

    const counter = Number(window.sessionStorage.getItem(SESSION_PROFILE_STUCK_COUNT_KEY) || '0')
    console.warn('[useAuth] stuck iteration', {
      counter,
      threshold: SESSION_PROFILE_STUCK_THRESHOLD,
      userId: user.id,
    })
    const shouldReset = registerSessionProfileStuckAndShouldClear()
    if (!shouldReset) {
      void useAuthStore.getState().fetchProfile()
      return
    }

    console.error(
      '[useAuth] session exists but profile failed repeatedly — WOULD force signOut. ' +
      'Look upstream for [fetchProfile] errors to see WHY the profile lookup keeps coming back null/error.',
    )
    // Auto-signOut intentionally DISABLED. The original safety net (clear local
    // tokens + force fresh login after 3 missed profile fetches) was masking
    // the real failure mode: profile lookups returning null didn't mean the
    // session was corrupted, just that the user didn't have a profiles row yet
    // (or RLS blocked it). Kicking the user out gave a "logged in for a split
    // second then logged out" experience. Keep the logging, drop the action.
    // Re-enable explicitly only after we've actually confirmed an
    // unrecoverable-token failure mode that this catch would solve.
    resetSessionProfileStuckCounter()
  }, [session, user, profile, loading, profileLoading])

  return {
    user,
    session,
    profile,
    loading,
    profileLoading,
    isAuthenticated: Boolean(session),
    onboardingDone: profile?.onboarding_done ?? false,
    signOut,
    signOutClearEverything,
    refreshProfile: fetchProfile,
  }
}
