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

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        if (!mounted) return
        setSession(s)
        setLoading(false)
        if (s?.user) {
          resetAuthFailureCounter()
          resetSessionProfileStuckCounter()
          void useAuthStore.getState().fetchProfile()
        }
      })
      .catch((e) => {
        console.error('[auth] getSession failed', e)
        registerAuthFailureAndMaybeClearCorruptedToken()
        if (!mounted) return
        setSession(null)
        setLoading(false)
      })

    return () => {
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
      const t = window.setTimeout(() => {
        void useAuthStore.getState().fetchProfile()
      }, wait)
      return () => window.clearTimeout(t)
    }

    const shouldReset = registerSessionProfileStuckAndShouldClear()
    if (!shouldReset) {
      void useAuthStore.getState().fetchProfile()
      return
    }

    console.error('[auth] session exists but profile failed repeatedly; clearing local auth token and forcing clean login')
    clearCorruptedSupabaseTokenStorage()
    resetSessionProfileStuckCounter()
    void supabase.auth.signOut().finally(() => {
      useAuthStore.setState({ user: null, session: null, profile: null, loading: false, profileLoading: false })
    })
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
