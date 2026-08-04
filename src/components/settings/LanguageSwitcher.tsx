import { useTranslation } from 'react-i18next'
import { setAppLanguage } from '../../i18n'
import { LANG_META, SUPPORTED_LANGS, type AppLang } from '../../i18n/lang'
import { cn } from '../../lib/utils'

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const current = (i18n.language?.split('-')[0] || 'he') as AppLang

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900', className)}>
      <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{t('settings.language')}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-500">{t('settings.languageHint')}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SUPPORTED_LANGS.map((lang) => {
          const active = current === lang
          return (
            <button
              key={lang}
              type="button"
              onClick={() => void setAppLanguage(lang)}
              className={cn(
                'rounded-xl border px-3 py-2.5 text-sm font-semibold transition',
                active
                  ? 'border-brand-500 bg-brand-500/15 text-brand-800 ring-1 ring-brand-500/40 dark:text-brand-200'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800'
              )}
              aria-pressed={active}
            >
              <span className="block">{LANG_META[lang].nativeLabel}</span>
              <span className="mt-0.5 block text-[10px] font-medium opacity-70">{t(`language.${lang}`)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
