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
    const redirectTo = `${window.location.origin}/auth/callback`

    try {
      setAppModeParent()
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      })

      if (error) {
        console.error('[Google OAuth]', error)
        toast.error(error.message || 'התחברות עם Google נכשלה.')
        setLoading(false)
        return
      }

      const url = data.url
      if (!url) {
        toast.error('לא התקבלה כתובת התחברות. ודאו ש-Google מופעל ב-Supabase (Authentication → Providers).')
        setLoading(false)
        return
      }

      window.location.assign(url)
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
