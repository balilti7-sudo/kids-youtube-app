import { useState } from 'react'
import { toast } from 'sonner'
import { setAppModeParent } from '../../lib/appMode'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

/** כתובת callback מוחלטת — תומך ב-subpath דרך Vite BASE_URL ובשינוי עם env. */
function buildOAuthRedirectTo(): string {
  const fromEnv = import.meta.env.VITE_AUTH_OAUTH_REDIRECT_TO?.trim()
  if (fromEnv) return fromEnv

  const origin = window.location.origin
  const rawBase = (import.meta.env.BASE_URL || '/').replace(/^\.\//, '/')
  const pathname = new URL(rawBase, `${origin}/`).pathname.replace(/\/+$/, '')
  const authPrefix = pathname && pathname !== '/' ? pathname : ''
  const path = `${authPrefix}/auth`.replace(/\/{2,}/g, '/')
  const next = encodeURIComponent('/dashboard')
  return `${origin}${path.startsWith('/') ? path : `/${path}`}?next=${next}`
}

export function GoogleAuthButton() {
  const [loading, setLoading] = useState(false)

  const signIn = async () => {
    if (!isSupabaseConfigured) {
      toast.error('האפליקציה לא מחוברת ל-Supabase. בדקו את ההגדרות בקובץ .env.')
      return
    }

    setLoading(true)
    const redirectTo = buildOAuthRedirectTo()

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
