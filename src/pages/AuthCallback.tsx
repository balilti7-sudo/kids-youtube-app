import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { setSkipParentalManagementGateOnce } from '../lib/parentalGateSkipOnce'
import { SplashScreen } from '../components/branding/SplashScreen'

/**
 * Dedicated landing route for OAuth providers — the only job of this component is to wait for
 * `onAuthStateChange` to confirm the post-redirect session and then push the user into the app.
 * Keep it intentionally minimal: no profile lookups, no protected-route logic.
 */
export default function AuthCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    let resolved = false

    const goNext = (path: string) => {
      if (resolved) return
      resolved = true
      setSkipParentalManagementGateOnce()
      navigate(path, { replace: true })
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        goNext('/')
      } else if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        goNext('/auth')
      }
    })

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) goNext('/')
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [navigate])

  return <SplashScreen />
}
