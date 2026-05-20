import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile } from '../types'
import { supabase } from '../lib/supabase'
import { clearChildAccessToken, getSavedChildAccessToken } from '../lib/childDevice'
import { clearAppMode, setAppModeKid, setAppModeParent } from '../lib/appMode'
import { clearParentPinSessions } from '../lib/lockParentApp'

/**
 * useAuth/LoginForm keep "stuck" / "failure" counters in sessionStorage that
 * can auto-sign-out the user after 3 consecutive misses. A genuine login race
 * (brief null-profile render between session-set and profile-set) was bumping
 * those counters even on success, so the user got bounced. Clear them on any
 * successful auth transition to keep the state clean.
 */
const AUTH_SESSION_COUNTER_KEYS = [
  'safetube_auth_failure_count',
  'safetube_session_profile_stuck_count',
  'safetube_login_failure_count',
] as const

function clearAuthSessionCounters() {
  try {
    for (const key of AUTH_SESSION_COUNTER_KEYS) {
      window.sessionStorage.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  profileLoading: boolean
  setSession: (session: Session | null) => void
  setUser: (user: User | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  fetchProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null; session: Session | null }>
  verifyEmailCode: (email: string, code: string) => Promise<{ error: Error | null }>
  signInWithMagicLink: (email: string, emailRedirectTo: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  /** ניקוי טוקן ילד, מצב הורה זמני ב-sessionStorage, והתנתקות Supabase */
  signOutClearEverything: () => Promise<void>
}

function buildSignupRedirectUrl() {
  const fromEnv = import.meta.env.VITE_AUTH_SIGNUP_REDIRECT_TO?.trim()
  if (fromEnv) return fromEnv
  return `${window.location.origin}/auth?emailVerified=1`
}

async function ensureProfileRowForUser(user: User): Promise<Profile | null> {
  const payload = {
    id: user.id,
    email: user.email ?? '',
    full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  }
  const { data, error } = await supabase.from('profiles').upsert(payload).select('*').maybeSingle()
  if (error) {
    console.error('[ensureProfileRowForUser] upsert failed', { message: error.message, code: error.code, userId: user.id })
    return null
  }
  if (!data) {
    console.warn('[ensureProfileRowForUser] upsert returned no data', { userId: user.id })
    return null
  }
  return data as Profile
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  profileLoading: false,

  setSession: (session) => set({ session, user: session?.user ?? null }),
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),

  fetchProfile: async () => {
    const user = get().user
    if (!user) {
      set({ profile: null, profileLoading: false })
      return
    }
    set({ profileLoading: true })
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    if (error) {
      console.warn('[fetchProfile] profiles select failed', { message: error.message, code: error.code })
      set({ profile: null, profileLoading: false })
      return
    }
    if (!data) {
      console.warn('[fetchProfile] no profile row; attempting on-the-fly upsert', user.id)
      const created = await ensureProfileRowForUser(user)
      set({ profile: created, profileLoading: false })
      return
    }
    set({ profile: data as Profile, profileLoading: false })
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error) {
      setAppModeParent()
      // Reset stuck/failure counters BEFORE the React re-render so the brief
      // null-profile window after session-set doesn't trip auto-signOut in useAuth.
      clearAuthSessionCounters()
      // No global onAuthStateChange listener anymore — sync the store ourselves.
      if (data.session) {
        set({ session: data.session, user: data.session.user, loading: false })
        void get().fetchProfile()
      }
    }
    return { error: error ? new Error(error.message) : null }
  },

  signUp: async (email, password) => {
    const emailRedirectTo = buildSignupRedirectUrl()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
      },
    })
    if (error) {
      const err = error as Error & { status?: number; code?: string }
      console.error('[Supabase auth.signUp] raw error object:', error)
      console.error('[Supabase auth.signUp] details:', {
        message: err.message,
        name: err.name,
        status: err.status,
        code: err.code,
      })
      return { error: new Error(error.message), session: null }
    }
    const session = data.session ?? null
    // Never keep an active session after sign-up; user must verify email first.
    await supabase.auth.signOut()
    return { error: null, session }
  },

  verifyEmailCode: async (email, code) => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'signup',
      })
      if (error) {
        const err = error as Error & { status?: number; code?: string }
        console.error('[Supabase auth.verifyOtp] details:', {
          message: err.message,
          name: err.name,
          status: err.status,
          code: err.code,
        })
      } else if (data.session) {
        clearAuthSessionCounters()
        // No global onAuthStateChange listener anymore — sync the store ourselves.
        set({ session: data.session, user: data.session.user, loading: false })
        void get().fetchProfile()
      }
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Supabase auth.verifyOtp] runtime failure:', msg)
      return { error: new Error(msg) }
    }
  },

  signInWithMagicLink: async (email, emailRedirectTo) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo,
        },
      })
      if (error) {
        const err = error as Error & { status?: number; code?: string }
        console.error('[Supabase auth.signInWithOtp] details:', {
          message: err.message,
          name: err.name,
          status: err.status,
          code: err.code,
          email,
        })
      } else {
        console.info('[Supabase auth.signInWithOtp] OTP/magic-link email requested:', { email })
      }
      return { error: error ? new Error(error.message) : null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Supabase auth.signInWithOtp] runtime failure:', msg)
      return { error: new Error(msg) }
    }
  },

  signOut: async () => {
    clearParentPinSessions()
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null, profileLoading: false })
    if (getSavedChildAccessToken()) {
      setAppModeKid()
    } else {
      clearAppMode()
    }
  },

  signOutClearEverything: async () => {
    clearChildAccessToken()
    clearParentPinSessions()
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null, profileLoading: false })
  },
}))
