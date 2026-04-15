import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import type { Profile } from '../types'
import { supabase } from '../lib/supabase'

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
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>
  verifyEmailCode: (email: string, code: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
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
    if (error || !data) {
      set({ profile: null, profileLoading: false })
      return
    }
    set({ profile: data as Profile, profileLoading: false })
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
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
      return { error: new Error(error.message) }
    }
    return { error: null }
  },

  verifyEmailCode: async (email, code) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    })
    return { error: error ? new Error(error.message) : null }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, profile: null, profileLoading: false })
  },
}))
