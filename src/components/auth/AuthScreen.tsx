import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageBackBar } from '../layout/PageBackBar'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { GoogleAuthButton } from './GoogleAuthButton'
import { LoginForm } from './LoginForm'
import { RegisterForm } from './RegisterForm'
import { EmailQuickAuthForm } from './EmailQuickAuthForm'
import { OnboardingStepper } from '../onboarding/OnboardingStepper'
import { Button } from '../ui/Button'

/** Google first (largest). Email/password stay below as the secondary path. */
export function AuthScreen() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [showEmailLink, setShowEmailLink] = useState(false)

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-3 pb-8 pt-4 xs:px-4 sm:gap-4 sm:pb-10 sm:pt-6">
      <PageBackBar fallback="/dashboard" className="mb-0 justify-center sm:justify-start" />

      <OnboardingStepper
        className="mb-1"
        steps={[
          { label: t('onboarding.stepAuthLabel'), status: 'current' },
          { label: t('onboarding.stepActionLabel'), status: 'upcoming' },
          { label: t('onboarding.stepValueLabel'), status: 'upcoming' },
        ]}
      />

      <section
        className="text-center sm:rounded-2xl -mx-3 bg-black px-3 py-5 xs:-mx-4 xs:px-4 sm:mx-0 sm:py-6"
        aria-label="מיתוג SafeTube"
      >
        <SafeTubeLogo size="lg" entranceAnimation />
        <p className="mt-2 text-sm text-zinc-300 sm:mt-3">{t('auth.tagline')}</p>
      </section>

      <div className="app-floating-surface p-4 sm:p-5">
        <h1 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 sm:text-xl">
          {t('auth.step1Title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">{t('auth.step1Lead')}</p>

        <div className="mt-5">
          <GoogleAuthButton size="lg" />
        </div>

        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200 dark:border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-slate-500 dark:bg-zinc-900 dark:text-zinc-500">
              {t('auth.or')}
            </span>
          </div>
        </div>

        <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-zinc-300">
          {t('auth.passwordSectionTitle')}
        </p>

        {mode === 'login' ? (
          <LoginForm onSwitchToRegister={() => setMode('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setMode('login')} />
        )}

        <div className="mt-4">
          <Button
            type="button"
            variant="ghost"
            className="w-full text-sm"
            aria-expanded={showEmailLink}
            onClick={() => setShowEmailLink((v) => !v)}
          >
            {showEmailLink ? t('auth.hideMoreOptions') : t('auth.moreOptions')}
          </Button>
        </div>

        {showEmailLink ? (
          <div className="mt-3 border-t border-slate-200 pt-4 dark:border-zinc-700">
            <p className="mb-3 text-xs text-slate-500 dark:text-zinc-500">{t('auth.emailLinkHint')}</p>
            <EmailQuickAuthForm />
          </div>
        ) : null}
      </div>
    </div>
  )
}
