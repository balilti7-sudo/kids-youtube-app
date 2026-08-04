export const SUPPORTED_LANGS = ['he', 'en', 'es', 'ru'] as const
export type AppLang = (typeof SUPPORTED_LANGS)[number]

export const LANG_STORAGE_KEY = 'safetube_lang_v1'

export const LANG_META: Record<
  AppLang,
  { label: string; nativeLabel: string; dir: 'rtl' | 'ltr' }
> = {
  he: { label: 'Hebrew', nativeLabel: 'עברית', dir: 'rtl' },
  en: { label: 'English', nativeLabel: 'English', dir: 'ltr' },
  es: { label: 'Spanish', nativeLabel: 'Español', dir: 'ltr' },
  ru: { label: 'Russian', nativeLabel: 'Русский', dir: 'ltr' },
}

export function isAppLang(value: string | null | undefined): value is AppLang {
  return !!value && (SUPPORTED_LANGS as readonly string[]).includes(value)
}

export function readStoredLang(): AppLang | null {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY)
    return isAppLang(raw) ? raw : null
  } catch {
    return null
  }
}

export function detectInitialLang(): AppLang {
  const stored = readStoredLang()
  if (stored) return stored
  try {
    const nav = (navigator.language || 'he').toLowerCase()
    if (nav.startsWith('he') || nav.startsWith('iw')) return 'he'
    if (nav.startsWith('es')) return 'es'
    if (nav.startsWith('ru')) return 'ru'
    if (nav.startsWith('en')) return 'en'
  } catch {
    /* ignore */
  }
  return 'he'
}

export function applyDocumentLang(lang: AppLang) {
  const meta = LANG_META[lang]
  document.documentElement.lang = lang
  document.documentElement.dir = meta.dir
}
