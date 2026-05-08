import { useState } from 'react'
import { toast } from 'sonner'
import { setAppModeParent } from '../../lib/appMode'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export function GoogleAuthButton() {
  const [loading, setLoading] = useState(false)

  const signIn = async () => {
    if (!isSupabaseConfigured) {
      toast.error('האפליקציה לא מחוברת ל-Supabase. בדקו את ההגדרות בקובץ .env.')
      return
    }

    setLoading(true)
    try {
      setAppModeParent()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        console.error('[Google OAuth]', error)
        toast.error(error.message || 'התחברות עם Google נכשלה.')
        setLoading(false)
        return
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Google OAuth]', e)
      toast.error(msg || 'שגיאה בהתחברות עם Google.')
      setLoading(false)
    }
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
