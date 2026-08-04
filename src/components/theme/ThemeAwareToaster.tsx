import { Toaster } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { LANG_META, type AppLang } from '../../i18n/lang'

export function ThemeAwareToaster() {
  const { isDark } = useTheme()
  const { i18n } = useTranslation()
  const lang = (i18n.language?.split('-')[0] || 'he') as AppLang
  const dir = LANG_META[lang]?.dir ?? 'rtl'
  return <Toaster richColors position="top-center" dir={dir} theme={isDark ? 'dark' : 'light'} />
}
