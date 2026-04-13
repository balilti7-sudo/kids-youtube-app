import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return
      setSession(s)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setSession, setLoading])

  useEffect(() => {
    if (user) void fetchProfile()
    else useAuthStore.setState({ profile: null, profileLoading: false })
  }, [user, fetchProfile])

  return {
    user,
    session,
    profile,
    loading,
    profileLoading,
    isAuthenticated: Boolean(user),
    onboardingDone: profile?.onboarding_done ?? false,
    signOut,
    refreshProfile: fetchProfile,
  }
}
