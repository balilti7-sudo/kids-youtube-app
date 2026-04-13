import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function GoogleAuthButton() {
  const [loading, setLoading] = useState(false)

  const signIn = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
    setLoading(false)
    if (error) console.error(error)
  }

  return (
    <Button type="button" variant="secondary" className="w-full !text-zinc-100" onClick={signIn} disabled={loading}>
      {loading ? (
        <LoadingSpinner className="h-5 w-5 border-2 border-zinc-400 border-t-transparent" />
      ) : null}
      המשך עם Google
    </Button>
  )
}
