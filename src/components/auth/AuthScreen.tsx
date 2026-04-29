import { useLocation } from 'react-router-dom'
import { PageBackBar } from '../layout/PageBackBar'
import { GoogleAuthButton } from './GoogleAuthButton'
import { MagicLinkForm } from './MagicLinkForm'

export function AuthScreen() {
  const location = useLocation()
  const emailVerified = new URLSearchParams(location.search).get('emailVerified') === '1'
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pb-12 pt-10">
      <PageBackBar fallback="/dashboard" className="mb-0 justify-center sm:justify-start" />
      <div className="text-center">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-zinc-50">SafeTube</h1>
        <p className="mt-1 text-sm text-slate-700 dark:text-zinc-400">הורים בשליטה — YouTube בטוח יותר לילדים</p>
      </div>

      <div className="app-floating-surface p-6">
        {emailVerified ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-100">
            האימייל אומת בהצלחה. אפשר להתחבר.
          </div>
        ) : null}
        <MagicLinkForm />

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-slate-500 dark:bg-zinc-900 dark:text-zinc-500">או</span>
          </div>
        </div>

        <GoogleAuthButton />
      </div>
    </div>
  )
}
