import { useLocation } from 'react-router-dom'
import { useState } from 'react'
import { PageBackBar } from '../layout/PageBackBar'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { GoogleAuthButton } from './GoogleAuthButton'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'

export function AuthScreen() {
  const location = useLocation()
  const emailVerified = new URLSearchParams(location.search).get('emailVerified') === '1'
  const [mode, setMode] = useState<'login' | 'register'>('login')
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pb-12 pt-10">
      <PageBackBar fallback="/dashboard" className="mb-0 justify-center sm:justify-start" />
      <div className="text-center">
        <SafeTubeLogo className="mx-auto h-14 w-auto max-w-[min(100%,320px)]" />
        <p className="mt-3 text-sm text-slate-700 dark:text-zinc-400">הורים בשליטה — YouTube בטוח יותר לילדים</p>
      </div>

      <div className="app-floating-surface p-6">
        {emailVerified ? (
          <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-100">
            האימייל אומת בהצלחה. אפשר להתחבר.
          </div>
        ) : null}
        <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`px-3 py-2 text-sm font-semibold transition ${
              mode === 'login'
                ? 'bg-brand-600 text-white dark:bg-brand-600 dark:text-white'
                : 'bg-transparent text-slate-600 dark:text-zinc-300'
            }`}
          >
            התחברות
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`px-3 py-2 text-sm font-semibold transition ${
              mode === 'register'
                ? 'bg-brand-600 text-white dark:bg-brand-600 dark:text-white'
                : 'bg-transparent text-slate-600 dark:text-zinc-300'
            }`}
          >
            הרשמה
          </button>
        </div>

        {mode === 'login' ? (
          <LoginForm onSwitchToRegister={() => setMode('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setMode('login')} />
        )}

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
